<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '../stores/player'

const emit = defineEmits(['added', 'select'])
const store = usePlayerStore()
const urlInput = ref('')
const isAdding = ref(false)
const addError = ref('')
const showSelect = ref(false)

const addPlaylist = async () => {
  const url = urlInput.value.trim()
  if (!url) return
  
  isAdding.value = true
  addError.value = ''
  
  try {
    await store.fetchM3U(url)
    urlInput.value = ''
    emit('added')
  } catch (e) {
    addError.value = e instanceof Error ? e.message : 'Ошибка'
  } finally {
    isAdding.value = false
  }
}

const loadSaved = async (url: string) => {
  isAdding.value = true
  addError.value = ''
  
  try {
    await store.fetchM3U(url)
    emit('select', url)
  } catch (e) {
    addError.value = e instanceof Error ? e.message : 'Ошибка'
  } finally {
    isAdding.value = false
  }
}

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short'
  })
}
</script>

<template>
  <div class="playlist-manager">
    <div v-if="store.playlists.length > 0" class="saved-section">
      <button class="select-btn" @click="showSelect = !showSelect">
        Выбрать из списка ▼
      </button>
      
      <div v-if="showSelect" class="saved-dropdown">
        <div 
          v-for="playlist in store.playlists" 
          :key="playlist.url"
          class="saved-item"
          :class="{ active: store.currentPlaylist?.url === playlist.url }"
          @click="loadSaved(playlist.url)"
        >
          <div class="item-name">{{ playlist.name }}</div>
          <div class="item-date">{{ formatDate(playlist.lastUsed) }}</div>
        </div>
      </div>
    </div>
    
    <div class="add-section">
      <div class="input-wrapper">
        <input
          v-model="urlInput"
          type="text"
          class="url-input"
          placeholder="URL плейлиста..."
          @keyup.enter="addPlaylist"
        />
        <button 
          class="add-btn" 
          :disabled="!urlInput.trim() || isAdding"
          @click="addPlaylist"
        >
          {{ isAdding ? '...' : 'Добавить' }}
        </button>
      </div>
      <div v-if="addError" class="error-text">{{ addError }}</div>
    </div>
  </div>
</template>

<style scoped>
.playlist-manager {
  padding: 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

@media (max-width: 480px) {
  .playlist-manager {
    padding: 12px;
  }
  
  .input-wrapper {
    flex-direction: column;
  }
  
  .url-input {
    min-width: 100%;
  }
  
  .add-btn {
    width: 100%;
  }
}

.saved-section {
  margin-bottom: 16px;
}

.select-btn {
  width: 100%;
  padding: 12px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.select-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.saved-dropdown {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.saved-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.saved-item:hover {
  background: var(--bg-elevated);
}

.saved-item.active {
  background: var(--glow-accent);
  border: 1px solid var(--border-active);
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.item-date {
  font-size: 11px;
  color: var(--text-muted);
}

.add-section {
  margin-bottom: 0;
}

.input-wrapper {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.url-input {
  flex: 1;
  min-width: 180px;
  padding: 12px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--text-primary);
}

.url-input:focus {
  border-color: var(--accent-primary);
}

.add-btn {
  padding: 12px 20px;
  background: var(--accent-primary);
  color: var(--bg-primary);
  font-size: 14px;
  font-weight: 600;
  border-radius: var(--radius-md);
  white-space: nowrap;
}

.add-btn:disabled {
  opacity: 0.5;
}

.error-text {
  margin-top: 8px;
  font-size: 13px;
  color: var(--accent-warning);
}
</style>