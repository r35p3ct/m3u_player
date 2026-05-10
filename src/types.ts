export interface Channel {
  id: string
  name: string
  url: string
  group?: string
  logo?: string
  tvgLogo?: string
  tvgId?: string
}

export interface M3UPlaylist {
  name: string
  url: string
  channels: Channel[]
  addedAt: number
}

export interface EPGProgram {
  id: string
  title: string
  description?: string
  start: Date
  end: Date
  channel: string
}

export interface SavedPlaylist {
  url: string
  name: string
  lastUsed: number
}