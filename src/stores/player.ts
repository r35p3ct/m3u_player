import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Channel, M3UPlaylist, SavedPlaylist, EPGProgram } from '../types'

const PROXY_PREFIX = `${import.meta.env.BASE_URL}proxy?url=`

const isSameOrigin = (url: string): boolean => {
  try {
    const u = new URL(url, window.location.href)
    return u.origin === window.location.origin
  } catch {
    return false
  }
}

const proxifyUrl = (url: string): string => {
  if (url.startsWith('http') && !isSameOrigin(url)) {
    return PROXY_PREFIX + encodeURIComponent(url)
  }
  return url
}

const parseJsonUrls = (str: string): string[] => {
  try {
    const fixed = str.replace(/'/g, '"')
    const parsed = JSON.parse(fixed)
    if (Array.isArray(parsed)) {
      return parsed.filter((u: unknown) => typeof u === 'string')
    }
    return [parsed].filter((u: unknown) => typeof u === 'string')
  } catch {
    const arrMatch = str.match(/^\[([^\]]+)\]$/)
    if (arrMatch) {
      const urls = arrMatch[1].split(',').map((s: string) => {
        return s.trim().replace(/^["']|["']$/g, '')
      }).filter((u: string) => u.startsWith('http') || u.startsWith('/') || u.startsWith('epg'))
      return urls
    }
    return [str]
  }
}

export const usePlayerStore = defineStore('player', () => {
  const playlists = ref<SavedPlaylist[]>([])
  const currentPlaylist = ref<M3UPlaylist | null>(null)
  const channels = ref<Channel[]>([])
  const currentChannel = ref<Channel | null>(null)
  const isLoading = ref(false)
  const isLoadingEPG = ref(false)
  const error = ref<string | null>(null)
  const epgPrograms = ref<Map<string, EPGProgram[]>>(new Map())
  const epgUrls = ref<string[]>([])
  const isPlayerFullscreen = ref(false)
  const isAutoplay = ref(true)

  const currentProgram = computed(() => {
    if (!currentChannel.value) return null
    const now = new Date()
    const progs = matchChannelToEPG(currentChannel.value.name)
    if (!progs) return null
    return progs.find(p => p.start <= now && p.end > now) || null
  })

  const remainingTime = computed(() => {
    const program = currentProgram.value
    if (!program) return null
    const remaining = program.end.getTime() - Date.now()
    if (remaining <= 0) return null
    const mins = Math.floor(remaining / 60000)
    if (mins < 60) return `${mins} мин`
    const hours = Math.floor(mins / 60)
    const minsLeft = mins % 60
    return minsLeft > 0 ? `${hours}ч ${minsLeft}м` : `${hours}ч`
  })

  function loadSavedPlaylists() {
    const saved = localStorage.getItem('m3u_playlists')
    if (saved) {
      playlists.value = JSON.parse(saved)
    }
    
    const lastPlaylistUrl = localStorage.getItem('m3u_last_playlist')
    if (lastPlaylistUrl) {
      const lastPlaylist = playlists.value.find(p => p.url === lastPlaylistUrl)
      if (lastPlaylist) {
        fetchM3UAndRestoreChannel(lastPlaylistUrl)
      }
    }
  }

  async function fetchM3UAndRestoreChannel(url: string) {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await fetch(proxifyUrl(url))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      const parsed = parseM3U(text, url)
      
      currentPlaylist.value = { url, name: parsed.name, channels: parsed.channels, addedAt: Date.now() }
      channels.value = parsed.channels
      
      if (parsed.epgUrls.length > 0) {
        epgUrls.value = parsed.epgUrls
        loadEPGFromUrls(parsed.epgUrls)
      }
      
      const savedChannelUrl = getSavedChannelUrl()
      let channelToSet: Channel | null = null
      
      if (savedChannelUrl) {
        const found = parsed.channels.find(ch => ch.url === savedChannelUrl)
        if (found) {
          channelToSet = found
        }
      }
      
      if (!channelToSet && parsed.channels.length > 0) {
        channelToSet = parsed.channels[0]
      }
      
      if (channelToSet) {
        currentChannel.value = channelToSet
        saveCurrentChannelByUrl(channelToSet.url)
      }
      
      savePlaylist({ url, name: parsed.name, lastUsed: Date.now() })
      saveCurrentPlaylist(url)
      
      return parsed
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load playlist'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  function saveCurrentPlaylist(url: string) {
    localStorage.setItem('m3u_last_playlist', url)
  }

  function saveCurrentChannelByUrl(url: string) {
    localStorage.setItem('m3u_last_channel_url', url)
  }

  function getSavedChannelUrl(): string | null {
    return localStorage.getItem('m3u_last_channel_url')
  }

  function findChannelByUrl(url: string): Channel | undefined {
    return channels.value.find(ch => ch.url === url)
  }

  function savePlaylist(playlist: SavedPlaylist) {
    const existing = playlists.value.findIndex(p => p.url === playlist.url)
    if (existing >= 0) {
      playlists.value[existing] = { ...playlist, lastUsed: Date.now() }
    } else {
      playlists.value.push({ ...playlist, lastUsed: Date.now() })
    }
    localStorage.setItem('m3u_playlists', JSON.stringify(playlists.value))
  }

  function removePlaylist(url: string) {
    playlists.value = playlists.value.filter(p => p.url !== url)
    localStorage.setItem('m3u_playlists', JSON.stringify(playlists.value))
  }

  async function loadEPGFromUrls(urls: string[]) {
    isLoadingEPG.value = true
    
    for (const url of urls) {
      try {
        const response = await fetch(proxifyUrl(url))
        
        if (!response.ok) {
          console.warn('EPG response not OK:', response.status, response.statusText)
          continue
        }
        
        const contentType = response.headers.get('content-type') || ''
        const contentLength = response.headers.get('content-length')
        
        if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
          console.warn('EPG file too large:', contentLength)
          continue
        }
        
        const isGzip = contentType.includes('gzip') || 
                      url.endsWith('.gz') || 
                      url.endsWith('.xml.gz') ||
                      contentType.includes('octet-stream') ||
                      contentType.includes('binary')
        
        let text: string
        
        if (isGzip) {
          let buffer: ArrayBuffer | null = null
          try {
            buffer = await response.arrayBuffer()
            const decompressed = await decompressGzip(buffer)
            text = decompressed
          } catch {
            if (buffer) {
              const dec = new TextDecoder('utf-8')
              text = dec.decode(buffer)
            } else {
              continue
            }
          }
        } else {
          text = await response.text()
        }
        
        if (text && text.length > 0 && (text.includes('<?xml') || text.includes('<tv') || text.includes('programme'))) {
          parseEPG(text)
          console.log('EPG loaded, size:', text.length)
        } else {
          console.warn('EPG response invalid or empty, length:', text?.length)
        }
      } catch (e) {
        console.warn('Failed to load EPG from', url, e)
      }
    }
    
    isLoadingEPG.value = false
  }

  async function decompressGzip(buffer: ArrayBuffer): Promise<string> {
    const ds = new DecompressionStream('gzip')
    const writer = ds.writable.getWriter()
    writer.write(new Uint8Array(buffer))
    writer.close()
    const response = new Response(ds.readable)
    return response.text()
  }

  function parseEPG(xmlContent: string) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlContent, 'text/xml')
    
    const channelPrograms = new Map<string, EPGProgram[]>()
    
    const programElements = doc.querySelectorAll('programme')
    programElements.forEach(el => {
      const channel = el.getAttribute('channel')
      if (!channel) return
      
      const startStr = el.getAttribute('start')
      const stopStr = el.getAttribute('stop')
      if (!startStr || !stopStr) return
      
      const start = parseEPGDate(startStr)
      const end = parseEPGDate(stopStr)
      if (!start || !end) return
      
      const title = el.querySelector('title')?.textContent || 'Unknown'
      const desc = el.querySelector('desc')?.textContent
      
      const program: EPGProgram = {
        id: `${channel}_${start.getTime()}`,
        title,
        description: desc,
        start,
        end,
        channel
      }
      
      if (!channelPrograms.has(channel)) {
        channelPrograms.set(channel, [])
      }
      channelPrograms.get(channel)!.push(program)
    })
    
    const channelNameMapping = new Map<string, string>()
    const channelElements = doc.querySelectorAll('channel')
    channelElements.forEach(chEl => {
      const id = chEl.getAttribute('id')
      const displayName = chEl.querySelector('display-name')?.textContent
      if (id && displayName) {
        channelNameMapping.set(id, displayName)
        channelNameMapping.set(displayName.toLowerCase(), id)
      }
    })
    
    channelPrograms.forEach((programs, channelId) => {
      const sorted = programs.sort((a, b) => a.start.getTime() - b.start.getTime())
      epgPrograms.value.set(channelId, sorted)
      epgPrograms.value.set(channelId.toLowerCase(), sorted)
      
      const altId = channelNameMapping.get(channelId)
      if (altId && altId !== channelId) {
        epgPrograms.value.set(altId.toLowerCase(), sorted)
      }
      
      const dispName = channelNameMapping.get(channelId.toLowerCase())
      if (dispName) {
        epgPrograms.value.set(dispName.toLowerCase(), sorted)
      }
    })
  }

  function parseEPGDate(dateStr: string): Date | null {
    try {
      const str = dateStr.replace(/[-:]/g, '').replace(/ /g, '')
      const year = parseInt(str.slice(0, 4))
      const month = parseInt(str.slice(4, 6)) - 1
      const day = parseInt(str.slice(6, 8))
      const hour = parseInt(str.slice(8, 10))
      const minute = parseInt(str.slice(10, 12))
      return new Date(Date.UTC(year, month, day, hour, minute))
    } catch {
      return null
    }
  }

  function findChannelId(channelName: string): string | null {
    const name = channelName.toLowerCase().trim()
    for (const [chId] of epgPrograms.value) {
      if (chId.toLowerCase() === name) return chId
    }
    for (const [chId] of epgPrograms.value) {
      const chIdLower = chId.toLowerCase()
      if (chIdLower.includes(name) || name.includes(chIdLower)) return chId
    }
    return null
  }

  function matchChannelToEPG(channelName: string): EPGProgram[] | null {
    if (!channelName) return null
    const name = channelName.toLowerCase().trim()
    
    const programs = epgPrograms.value.get(name)
    if (programs && programs.length > 0) return programs
    
    for (const [epgId, progs] of epgPrograms.value) {
      const epgIdLower = epgId.toLowerCase()
      if (epgIdLower.includes(name) || name.includes(epgIdLower)) {
        return progs
      }
    }
    
    return null
  }

  async function fetchM3U(url: string) {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await fetch(proxifyUrl(url))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      const parsed = parseM3U(text, url)
      
      currentPlaylist.value = { url, name: parsed.name, channels: parsed.channels, addedAt: Date.now() }
      channels.value = parsed.channels
      
      if (parsed.epgUrls.length > 0) {
        epgUrls.value = parsed.epgUrls
        loadEPGFromUrls(parsed.epgUrls)
      }
      
      if (parsed.channels.length > 0) {
        setCurrentChannel(parsed.channels[0])
      }
      
      savePlaylist({ url, name: parsed.name, lastUsed: Date.now() })
      saveCurrentPlaylist(url)
      
      return parsed
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load playlist'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  function parseM3U(content: string, url: string): { name: string; channels: Channel[]; epgUrls: string[] } {
    const lines = content.split('\n')
    const channels: Channel[] = []
    const epgUrls: string[] = []
    let name = 'Playlist'
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      
      if (line.startsWith('#EXTM3U')) {
        const urlTvgMatch = line.match(/url-tvg="([^"]*)"/)
        if (urlTvgMatch) {
          const urls = parseJsonUrls(urlTvgMatch[1])
          epgUrls.push(...urls)
        }
        
        const tvgUrlMatch = line.match(/x-tvg-url="([^"]*)"/)
        if (tvgUrlMatch) {
          const urls = parseJsonUrls(tvgUrlMatch[1])
          epgUrls.push(...urls)
        }
        
        // Обрабатываем относительные пути как /m3u-player/epg/...
        const relativeMatch = line.match(/\/m3u-player\/epg\/[^\s"']+/)
        if (relativeMatch) {
          epgUrls.push(relativeMatch[0])
        }
        
        // Также /epg/... без префикса
        const epgMatch = line.match(/["']?\/epg\/[^\s"']+/)
        if (epgMatch) {
          const path = epgMatch[0].replace(/^["']/, '')
          if (!path.startsWith('/m3u-player')) {
            epgUrls.push('/m3u-player' + path)
          }
        }
      }
      
      if (line.startsWith('#EXTINF:')) {
        const props: Partial<Channel> = {}
        const attrs = line.slice(8)
        
        const groupMatch = attrs.match(/group-title="([^"]*)"/)
        if (groupMatch) props.group = groupMatch[1]
        
        const logoMatch = attrs.match(/tvg-logo="([^"]*)"/)
        if (logoMatch) props.tvgLogo = logoMatch[1]
        
        const idMatch = attrs.match(/tvg-id="([^"]*)"/)
        if (idMatch) props.tvgId = idMatch[1]
        
        const commaIndex = attrs.indexOf(',')
        const channelName = commaIndex >= 0 ? attrs.slice(commaIndex + 1).trim() : 'Unknown'
        
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim()
          if (nextLine && !nextLine.startsWith('#')) {
            const channelId = props.tvgId || channelName
            
            const channel: Channel = {
              id: channelId,
              name: channelName,
              url: nextLine,
              group: props.group,
              logo: props.tvgLogo,
              tvgId: props.tvgId,
              tvgLogo: props.tvgLogo
            }
            channels.push(channel)
            
            if (channels.length === 1) {
              name = props.group || 'Playlist'
            }
            i++
          }
        }
      } else if (line.startsWith('#PLAYLIST:')) {
        name = line.slice(10).trim().replace(/^:/, '')
      }
    }
    
    return { name: name || 'Playlist', channels, epgUrls }
  }

  function setCurrentChannel(channel: Channel) {
    currentChannel.value = channel
    saveCurrentChannelByUrl(channel.url)
  }

  function toggleFullscreen() {
    isPlayerFullscreen.value = !isPlayerFullscreen.value
  }

  return {
    playlists,
    currentPlaylist,
    channels,
    currentChannel,
    isLoading,
    isLoadingEPG,
    error,
    epgPrograms,
    epgUrls,
    isPlayerFullscreen,
    isAutoplay,
    currentProgram,
    remainingTime,
    loadSavedPlaylists,
    savePlaylist,
    removePlaylist,
    fetchM3U,
    fetchM3UAndRestoreChannel,
    parseM3U,
    setCurrentChannel,
    toggleFullscreen,
    loadEPGFromUrls,
    findChannelId,
    matchChannelToEPG,
    saveCurrentChannelByUrl,
    getSavedChannelUrl,
    findChannelByUrl
  }
})