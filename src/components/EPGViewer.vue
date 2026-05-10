<script setup lang="ts">
import { computed, onMounted, nextTick, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import type { EPGProgram } from '../types'

const store = usePlayerStore()
const contentRef = ref<HTMLElement | null>(null)

const currentChannel = computed(() => store.currentChannel)

const todayPrograms = computed(() => {
  if (!currentChannel.value) return []
  
  let programs = store.matchChannelToEPG(currentChannel.value.name) || []
  
  if (programs.length === 0) {
    programs = store.epgPrograms.get(currentChannel.value.id) || []
  }
  
  if (programs.length === 0) {
    programs = store.epgPrograms.get(currentChannel.value.name.toLowerCase()) || []
  }
  
  if (!programs || programs.length === 0) return []
  
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)
  
  return programs
    .filter(p => p.end >= startOfDay && p.start < endOfDay)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
})

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

const formatDuration = (start: Date, end: Date) => {
  const mins = Math.round((end.getTime() - start.getTime()) / 60000)
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}ч ${m}м` : `${h}ч`
  }
  return `${mins}м`
}

const isCurrentProgram = (program: EPGProgram) => {
  const now = new Date()
  return program.start <= now && program.end > now
}

const isPastProgram = (program: EPGProgram) => {
  return program.end < new Date()
}

const today = new Date().toLocaleDateString('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

const scrollToCurrent = () => {
  nextTick(() => {
    const currentEl = document.querySelector('.program-item.current') as HTMLElement
    if (currentEl && contentRef.value) {
      const container = contentRef.value
      container.scrollTop = currentEl.offsetTop - 50
    }
  })
}

watch(() => store.currentChannel, () => {
  scrollToCurrent()
})

watch(todayPrograms, () => {
  if (todayPrograms.value.length > 0) {
    scrollToCurrent()
  }
}, { immediate: true })
</script>

<template>
  <div class="epg-viewer">
    <div class="epg-header">
      <div class="header-info">
        <h2 class="epg-title">Программа на {{ today }}</h2>
        <div v-if="currentChannel" class="channel-name">
          {{ currentChannel.name }}
        </div>
      </div>
    </div>
    
    <div class="epg-content" ref="contentRef">
      <div v-if="!currentChannel" class="epg-empty">
        <div class="empty-icon">📅</div>
        <div class="empty-text">Нет выбранного канала</div>
        <div class="empty-subtext">Выберите канал из списка</div>
      </div>
      
      <div v-else-if="store.isLoadingEPG && todayPrograms.length === 0" class="epg-empty">
        <div class="empty-icon">📡</div>
        <div class="empty-text">Загрузка программы...</div>
        <div class="empty-subtext">EPG подгружается в фоновом режиме</div>
      </div>
      
      <div v-else-if="todayPrograms.length === 0" class="epg-empty">
        <div class="empty-icon">📺</div>
        <div class="empty-text">Нет программы</div>
        <div class="empty-subtext">EPG загрузится автоматически</div>
      </div>
      
      <div v-else class="program-list">
        <div 
          v-for="program in todayPrograms" 
          :key="program.id"
          class="program-item"
          :class="{ 
            current: isCurrentProgram(program),
            past: isPastProgram(program)
          }"
        >
          <div class="program-time">
            <span class="time-start">{{ formatTime(program.start) }}</span>
            <span class="time-duration">{{ formatDuration(program.start, program.end) }}</span>
          </div>
          <div class="program-info">
            <div class="program-title">{{ program.title }}</div>
            <div v-if="program.description" class="program-desc">
              {{ program.description }}
            </div>
          </div>
          <div v-if="isCurrentProgram(program)" class="program-now">
            Сейчас
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.epg-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.epg-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.header-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.epg-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.channel-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--accent-primary);
}

.epg-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.epg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.4;
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

.program-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.program-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

.program-item.current {
  background: var(--glow-accent);
  border: 1px solid var(--border-active);
}

.program-item.past {
  opacity: 0.5;
}

.program-time {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 70px;
  text-align: center;
}

.time-start {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.time-duration {
  font-size: 11px;
  color: var(--text-muted);
}

.program-info {
  flex: 1;
  min-width: 0;
}

.program-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.program-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.program-now {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent-primary);
  background: rgba(0, 229, 160, 0.15);
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
}
</style>