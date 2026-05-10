<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '../stores/player'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'

const store = usePlayerStore()

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

const videoRef = ref<HTMLVideoElement | null>(null)
const hlsInstance = ref<Hls | null>(null)
const mpegtsPlayer = ref<mpegts.Player | null>(null)
const isPlaying = ref(false)
const isBuffering = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const isMuted = ref(false)
const showControls = ref(true)
const controlsTimeout = ref<number | null>(null)

const errorMessage = ref<string | null>(null)
const errorType = ref<'network' | 'other' | null>(null)
const currentUrl = ref<string>('')
const triedNativeFallback = ref(false)

const isLiveStream = computed(() => !Number.isFinite(duration.value) || duration.value <= 0)

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

const cleanupPlayer = () => {
  if (hlsInstance.value) {
    hlsInstance.value.destroy()
    hlsInstance.value = null
  }
  if (mpegtsPlayer.value) {
    mpegtsPlayer.value.pause()
    mpegtsPlayer.value.unload()
    mpegtsPlayer.value.detachMediaElement()
    mpegtsPlayer.value.destroy()
    mpegtsPlayer.value = null
  }
  if (videoRef.value) {
    videoRef.value.pause()
    videoRef.value.removeAttribute('src')
    videoRef.value.load()
  }
}

const canNativePlayHLS = (): boolean => {
  const video = document.createElement('video')
  return !!video.canPlayType('application/vnd.apple.mpegurl')
}

const isSafari = (): boolean => {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
}

const tryNativeFallback = (url: string) => {
  console.log('Trying native video fallback:', url)
  triedNativeFallback.value = true

  const isHLS = url.includes('.m3u8') || url.includes('m3u8')

  // Для HLS потоков нативный fallback имеет смысл только в Safari
  if (isHLS && !isSafari()) {
    errorMessage.value = 'Не удалось загрузить HLS поток. Возможные причины: поток защищён реферером, использует неподдерживаемый аудио-кодек (AC3), или недоступен из вашей сети (проверьте VPN).'
    errorType.value = 'other'
    return
  }

  cleanupPlayer()

  if (videoRef.value) {
    videoRef.value.src = proxifyUrl(url)
    if (store.isAutoplay) {
      videoRef.value.play().catch(e => {
        console.error('Native play error:', e)
        errorMessage.value = 'Не удалось воспроизвести канал. Возможно, поток защищён или требуется VPN.'
        errorType.value = 'other'
      })
    }
  }
}

const handleFatalHlsError = (data: any, url: string) => {
  if (data.type === (Hls as any).ErrorTypes.NETWORK_ERROR) {
    if (!triedNativeFallback.value) {
      errorMessage.value = 'Ошибка сети. Пробуем нативный плеер...'
      errorType.value = 'network'
      tryNativeFallback(url)
      return
    }

    errorMessage.value = 'Не удалось загрузить поток. Проверьте соединение или попробуйте открыть поток напрямую.'
    errorType.value = 'network'
  } else if (data.type === (Hls as any).ErrorTypes.MEDIA_ERROR) {
    if (hlsInstance.value) {
      hlsInstance.value.recoverMediaError()
      return
    }
    errorMessage.value = 'Ошибка медиа. Попробуйте перезагрузить канал.'
    errorType.value = 'other'
  } else {
    if (!triedNativeFallback.value) {
      tryNativeFallback(url)
      return
    }
    errorMessage.value = 'Неизвестная ошибка плеера'
    errorType.value = 'other'
  }
}

const initPlayer = async (url: string) => {
  if (!videoRef.value) return

  currentUrl.value = url
  errorMessage.value = null
  errorType.value = null
  isBuffering.value = true

  cleanupPlayer()

  const isHLS = url.includes('.m3u8') || url.includes('m3u8')
  const isMPEGTS = !isHLS && (url.includes('.mpegts') || url.includes('/mpegts') || url.includes('.m2ts') || url.endsWith('.ts'))

  if (isHLS && Hls.isSupported()) {
    const proxiedUrl = proxifyUrl(url)
    console.log('HLS supported, loading:', proxiedUrl)
    const hls = new Hls({
      xhrSetup: (xhr, url) => {
        if (url.startsWith('http')) {
          xhr.open('GET', proxifyUrl(url), true)
        }
      }
    })

    hls.loadSource(proxiedUrl)
    hls.attachMedia(videoRef.value)

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('HLS MANIFEST_PARSED')
      isBuffering.value = false
      errorMessage.value = null
      if (store.isAutoplay && videoRef.value) {
        videoRef.value.play()
          .then(() => console.log('Play started'))
          .catch(e => console.log('Play error:', e))
      }
    })

    hls.on(Hls.Events.ERROR, (_, data) => {
      console.error('HLS error:', data.type, data.details, data)
      if (data.fatal) {
        handleFatalHlsError(data, url)
      }
    })

    hlsInstance.value = hls
  } else if (isMPEGTS && mpegts.getFeatureList().mseLivePlayback) {
    console.log('MPEGTS supported, loading:', url)
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: proxifyUrl(url),
    })

    player.on(mpegts.Events.ERROR, (errorType: any, errorDetail: any) => {
      console.error('MPEGTS error:', errorType, errorDetail)
      isBuffering.value = false
      errorMessage.value = 'Ошибка загрузки MPEG-TS потока. Возможно, поток защищён реферером, требуется VPN, или формат не поддерживается.'
      errorType.value = 'other'
    })

    player.attachMediaElement(videoRef.value)
    player.load()

    if (store.isAutoplay) {
      const playPromise = player.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((e: any) => {
          console.error('MPEGTS play error:', e)
        })
      }
    }

    mpegtsPlayer.value = player
    isBuffering.value = false
  } else if (isHLS && videoRef.value.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native HLS
    videoRef.value.src = proxifyUrl(url)
    if (store.isAutoplay) {
      videoRef.value.play().catch(() => {})
    }
  } else {
    // Прогрессивный поток или MP4
    videoRef.value.src = proxifyUrl(url)
    if (store.isAutoplay) {
      videoRef.value.play().catch(() => {})
    }
  }
}

const retryCurrent = () => {
  triedNativeFallback.value = false
  if (currentUrl.value) {
    initPlayer(currentUrl.value)
  }
}

const openStreamDirectly = () => {
  window.open(currentUrl.value, '_blank')
}

const togglePlay = () => {
  if (!videoRef.value) return
  if (isPlaying.value) {
    videoRef.value.pause()
  } else {
    videoRef.value.play()
  }
}

const handlePlay = () => { isPlaying.value = true }
const handlePause = () => { isPlaying.value = false }
const handleWaiting = () => { isBuffering.value = true }
const handleCanPlay = () => { isBuffering.value = false }
const handleVideoError = () => {
  if (!videoRef.value || !videoRef.value.error) return
  const code = videoRef.value.error.code
  console.error('Video error:', code, videoRef.value.error.message)
  if (code === MediaError.MEDIA_ERR_NETWORK) {
    errorMessage.value = 'Ошибка сети при загрузке видео'
    errorType.value = 'network'
  } else if (code === MediaError.MEDIA_ERR_DECODE) {
    errorMessage.value = 'Ошибка декодирования видео. Формат не поддерживается.'
    errorType.value = 'other'
  } else if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    errorMessage.value = 'Формат потока не поддерживается браузером'
    errorType.value = 'other'
  } else {
    errorMessage.value = 'Ошибка воспроизведения'
    errorType.value = 'other'
  }
}
const handleTimeUpdate = () => {
  if (videoRef.value) {
    currentTime.value = videoRef.value.currentTime
  }
}
const handleLoadedMetadata = () => {
  if (videoRef.value) {
    duration.value = videoRef.value.duration
  }
}
const handleVolumeChange = () => {
  if (videoRef.value) {
    volume.value = videoRef.value.volume
    isMuted.value = videoRef.value.muted
  }
}

const seek = (e: MouseEvent) => {
  if (!videoRef.value || !duration.value) return
  const rect = (e.target as HTMLElement).getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  videoRef.value.currentTime = percent * duration.value
}

const toggleMute = () => {
  if (videoRef.value) {
    videoRef.value.muted = !videoRef.value.muted
  }
}

const changeVolume = (e: Event) => {
  const target = e.target as HTMLInputElement
  if (videoRef.value) {
    videoRef.value.volume = parseFloat(target.value)
  }
}

const handleFullscreenChange = () => {
  store.isPlayerFullscreen = !!document.fullscreenElement
  showControls.value = true
}

const toggleFullscreen = async () => {
  const container = document.querySelector('.video-container')
  if (!container) return
  
  try {
    if (!document.fullscreenElement) {
      await container.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch (e) {
    console.error('Fullscreen error:', e)
  }
}

const handleMouseMove = () => {
  showControls.value = true
  if (controlsTimeout.value) {
    clearTimeout(controlsTimeout.value)
  }
  controlsTimeout.value = window.setTimeout(() => {
    if (isPlaying.value) {
      showControls.value = false
    }
  }, 3000)
}

const handleKeydown = (e: KeyboardEvent) => {
  if (!videoRef.value) return
  switch (e.key) {
    case ' ':
    case 'k':
      e.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      e.preventDefault()
      videoRef.value.currentTime -= 10
      break
    case 'ArrowRight':
      e.preventDefault()
      videoRef.value.currentTime += 10
      break
    case 'ArrowUp':
      e.preventDefault()
      videoRef.value.volume = Math.min(1, videoRef.value.volume + 0.1)
      break
    case 'ArrowDown':
      e.preventDefault()
      videoRef.value.volume = Math.max(0, videoRef.value.volume - 0.1)
      break
    case 'm':
      toggleMute()
      break
    case 'f':
      toggleFullscreen()
      break
  }
}

watch(() => store.currentChannel, (channel) => {
  if (channel) {
    triedNativeFallback.value = false
    initPlayer(channel.url)
  }
}, { immediate: true })

onMounted(() => {
  if (store.currentChannel) {
    initPlayer(store.currentChannel.url)
  }
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
})

onUnmounted(() => {
  if (hlsInstance.value) {
    hlsInstance.value.destroy()
  }
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
})
</script>

<template>
  <div 
    class="video-container" 
    :class="{ fullscreen: store.isPlayerFullscreen }"
    @mousemove="handleMouseMove"
    @dblclick="toggleFullscreen"
  >
    <video
      ref="videoRef"
      class="video-player"
      playsinline
      @play="handlePlay"
      @pause="handlePause"
      @waiting="handleWaiting"
      @canplay="handleCanPlay"
      @error="handleVideoError"
      @timeupdate="handleTimeUpdate"
      @loadedmetadata="handleLoadedMetadata"
      @volumechange="handleVolumeChange"
      @click="togglePlay"
    />
    
    <div v-if="!store.currentChannel" class="video-placeholder">
      <div class="placeholder-icon">▶</div>
      <div class="placeholder-text">Выберите канал</div>
    </div>
    
    <div v-else-if="errorMessage" class="video-error">
      <div class="error-content">
        <div class="error-icon">⚠️</div>
        <div class="error-text">{{ errorMessage }}</div>
        <div class="error-actions">
          <button class="error-btn" @click="retryCurrent">🔄 Повторить</button>
          <button v-if="errorType === 'network'" class="error-btn secondary" @click="openStreamDirectly">
            🔗 Открыть поток
          </button>
          <button v-if="!triedNativeFallback && hlsInstance" class="error-btn secondary" @click="tryNativeFallback(currentUrl)">
            🎬 Нативный плеер
          </button>
        </div>
      </div>
    </div>
    
    <div v-else-if="isBuffering" class="video-loading">
      <div class="loader"></div>
    </div>
    
    <div class="video-controls" :class="{ visible: showControls || !isPlaying }">
      <div v-if="!isLiveStream" class="progress-bar" @click="seek">
        <div class="progress-fill" :style="{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }"></div>
      </div>
      
      <div class="controls-row">
        <div class="controls-left">
          <button class="control-btn play-btn" @click="togglePlay">
            <span v-if="isPlaying">⏸</span>
            <span v-else>▶</span>
          </button>
          
          <div class="volume-control">
            <button class="control-btn" @click="toggleMute">
              <span v-if="isMuted || volume === 0">🔇</span>
              <span v-else-if="volume < 0.5">🔉</span>
              <span v-else>🔊</span>
            </button>
            <input 
              type="range" 
              class="volume-slider" 
              min="0" 
              max="1" 
              step="0.05"
              :value="volume"
              @input="changeVolume"
            />
          </div>
          
          <div v-if="isLiveStream" class="live-badge">● LIVE</div>
          <div v-else class="time-display">
            {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
          </div>
        </div>
        
        <div class="controls-right">
          <div class="channel-label">{{ store.currentChannel?.name }}</div>
          
          <button class="control-btn fullscreen-btn" @click="toggleFullscreen">
            <span v-if="store.isPlayerFullscreen">⤓</span>
            <span v-else>⤢</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.video-container.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  aspect-ratio: unset;
  border-radius: 0;
}

.video-player {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.video-placeholder,
.video-loading,
.video-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
}

.video-error {
  background: rgba(0, 0, 0, 0.85);
  z-index: 10;
}

.error-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
  max-width: 400px;
}

.error-icon {
  font-size: 48px;
}

.error-text {
  font-size: 15px;
  color: var(--text-primary);
  line-height: 1.5;
}

.error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

.error-btn {
  padding: 10px 18px;
  background: var(--accent-primary);
  color: var(--bg-primary);
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--radius-md);
  transition: opacity 0.2s;
}

.error-btn:hover {
  opacity: 0.9;
}

.error-btn.secondary {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.placeholder-icon {
  font-size: 48px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.placeholder-text {
  font-size: 14px;
  color: var(--text-muted);
}

.loader {
  width: 40px;
  height: 40px;
  border: 3px solid var(--bg-elevated);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.video-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 20px 16px 12px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.video-controls.visible {
  opacity: 1;
}

.fullscreen .video-controls {
  position: fixed;
  bottom: 20px;
  left: 20px;
  right: 20px;
  max-width: 800px;
  margin: 0 auto;
  border-radius: var(--radius-md);
}

.progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  cursor: pointer;
  margin-bottom: 12px;
  transition: height var(--transition-fast);
}

.progress-bar:hover {
  height: 6px;
}

.progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.controls-left,
.controls-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.control-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.play-btn {
  font-size: 18px;
}

.volume-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.volume-slider {
  width: 0;
  opacity: 0;
  transition: all var(--transition-fast);
}

.volume-control:hover .volume-slider {
  width: 60px;
  opacity: 1;
}

.volume-slider {
  -webkit-appearance: none;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: var(--accent-primary);
  border-radius: 50%;
  cursor: pointer;
}

.time-display {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.live-badge {
  font-size: 11px;
  font-weight: 700;
  color: #ef4444;
  display: flex;
  align-items: center;
  gap: 4px;
}

.channel-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fullscreen-btn {
  font-size: 18px;
}</style>