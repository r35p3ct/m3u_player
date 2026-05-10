<script setup lang="ts">
import { computed, onMounted, nextTick, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import type { Channel } from '../types'

const emit = defineEmits(['select'])
const store = usePlayerStore()
const listRef = ref<HTMLElement | null>(null)
const searchQuery = ref('')

const filteredChannels = computed(() => {
  if (!searchQuery.value.trim()) return store.channels
  const query = searchQuery.value.toLowerCase().trim()
  return store.channels.filter(ch => 
    ch.name.toLowerCase().includes(query) || 
    (ch.group && ch.group.toLowerCase().includes(query))
  )
})

const groupedChannels = computed(() => {
  const groups: Record<string, Channel[]> = {}
  filteredChannels.value.forEach(ch => {
    const key = ch.group || 'Other'
    if (!groups[key]) groups[key] = []
    groups[key].push(ch)
  })
  return groups
})

const getCurrentProgram = (channelId: string, channelName: string) => {
  let programs = store.epgPrograms.get(channelId) || []
  if (programs.length === 0) {
    programs = store.matchChannelToEPG(channelName) || []
  }
  if (programs.length === 0) {
    programs = store.epgPrograms.get(channelName.toLowerCase()) || []
  }
  if (programs.length === 0) return null
  
  const now = new Date()
  return programs.find(p => p.start <= now && p.end > now) || null
}

const getRemainingTime = (channelId: string, channelName: string) => {
  const program = getCurrentProgram(channelId, channelName)
  if (!program) return null
  const remaining = program.end.getTime() - Date.now()
  if (remaining <= 0) return null
  const mins = Math.floor(remaining / 60000)
  if (mins < 60) return `${mins} мин`
  const hours = Math.floor(mins / 60)
  const minsLeft = mins % 60
  return minsLeft > 0 ? `${hours}ч ${minsLeft}м` : `${hours}ч`
}

const isLive = (channel: Channel) => {
  return store.currentChannel?.url === channel.url
}

const selectChannel = (channel: Channel) => {
  store.setCurrentChannel(channel)
  emit('select', channel)
}

const scrollToLive = () => {
  nextTick(() => {
    const activeEl = document.querySelector('.channel-item.active') as HTMLElement
    if (activeEl && listRef.value) {
      listRef.value.scrollTop = activeEl.offsetTop - 100
    }
  })
}

watch(() => store.currentChannel, () => {
  scrollToLive()
})

onMounted(() => {
  scrollToLive()
})
</script>

<template>
  <div class="channel-list">
    <div class="channel-search">
      <input 
        v-model="searchQuery"
        type="text" 
        placeholder="Поиск каналов..." 
        class="search-input"
      />
    </div>
    <div class="channels-scroll" ref="listRef">
      <div v-for="(channels, group) in groupedChannels" :key="group" class="channel-group">
        <div class="group-header">{{ group }}</div>
        <button
          v-for="channel in channels"
          :key="channel.id"
          class="channel-item"
          :class="{ active: isLive(channel) }"
          @click="selectChannel(channel)"
        >
          <div class="channel-info">
            <span class="channel-name">{{ channel.name }}</span>
            <span v-if="getCurrentProgram(channel.id, channel.name)" class="current-show">
              {{ getCurrentProgram(channel.id, channel.name)?.title }}
              <span v-if="getRemainingTime(channel.id, channel.name)" class="remaining-time">
                ({{ getRemainingTime(channel.id, channel.name) }})
              </span>
            </span>
          </div>
          <div v-if="isLive(channel)" class="live-badge">
            <span class="live-dot"></span>
            LIVE
          </div>
        </button>
      </div>
      
      <div v-if="store.channels.length === 0" class="empty-state">
        <div class="empty-icon">📡</div>
        <div class="empty-text">Нет каналов</div>
        <div class="empty-subtext">Добавьте M3U плейлист</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.channel-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.channel-search {
  padding: 12px 12px 8px;
}

.search-input {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
}

.search-input:focus {
  border-color: var(--accent-primary);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.channels-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
}

.channel-group {
  margin-bottom: 20px;
}

.group-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  padding: 8px 12px;
  margin-bottom: 4px;
}

.channel-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  transition: all var(--transition-fast);
  margin-bottom: 4px;
}

.channel-item:hover {
  background: var(--bg-tertiary);
}

.channel-item.active {
  background: var(--glow-accent);
  border: 1px solid var(--border-active);
}

.channel-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.channel-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.current-show {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.remaining-time {
  color: var(--accent-primary);
  margin-left: 4px;
}

.live-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  margin-left: 8px;
}

.live-dot {
  width: 6px;
  height: 6px;
  background: var(--accent-primary);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.empty-subtext {
  font-size: 13px;
  color: var(--text-muted);
}
</style>