<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from './stores/player'
import ChannelList from './components/ChannelList.vue'
import VideoPlayer from './components/VideoPlayer.vue'
import PlaylistManager from './components/PlaylistManager.vue'
import EPGViewer from './components/EPGViewer.vue'

const store = usePlayerStore()
const activeTab = ref<'player' | 'epg'>('player')
const showAddModal = ref(false)
const showChannelModal = ref(false)

const loadSavedPlaylist = async (url: string) => {
  await store.fetchM3U(url)
  showAddModal.value = false
}

const selectChannel = (channel: any) => {
  store.setCurrentChannel(channel)
  showChannelModal.value = false
}

const selectSavedPlaylist = () => {
  showAddModal.value = true
}

onMounted(() => {
  store.loadSavedPlaylists()
})

const isMobile = computed(() => window.innerWidth < 769)
</script>

<template>
  <div class="app">
    <!-- Глобальный лоадер -->
    <div v-if="store.isLoading" class="global-loader-overlay">
      <div class="global-loader">
        <span class="loader-spinner-large"></span>
        <span class="loader-text">Загрузка плейлиста...</span>
      </div>
    </div>
    
    <!-- Фоновый лоадер EPG -->
    <div v-if="store.isLoadingEPG" class="epg-loader-toast">
      <span class="loader-spinner"></span>
      <span class="loader-text">Загрузка программы передач...</span>
    </div>
    
    <!-- Мобильная кнопка каналов -->
    <button 
      v-if="isMobile" 
      class="mobile-channels-btn"
      @click="showChannelModal = true"
    >
      📋 Каналы
    </button>
    
    <!-- Модальное окно каналов -->
    <div v-if="showChannelModal" class="modal" @click.self="showChannelModal = false">
      <div class="modal-content channel-modal">
        <div class="modal-header">
          <h3>Каналы</h3>
          <button class="close-btn" @click="showChannelModal = false">×</button>
        </div>
        <div class="modal-body">
          <ChannelList @select="selectChannel" />
        </div>
      </div>
    </div>
    
    <!-- Модальное окно добавления -->
    <div v-if="showAddModal" class="modal" @click.self="showAddModal = false">
      <div class="modal-content add-modal">
        <div class="modal-header">
          <h3>Плейлист</h3>
          <button class="close-btn" @click="showAddModal = false">×</button>
        </div>
        <div class="modal-body">
          <PlaylistManager @added="showAddModal = false" @select="loadSavedPlaylist" />
        </div>
      </div>
    </div>
    
    <!-- Основной контент -->
    <main class="main">
      <header class="header">
        <div class="header-left">
          <div class="logo">
            <span class="logo-icon">📺</span>
            <span class="logo-text">M3U</span>
          </div>
          <div v-if="store.isLoading" class="header-loader">
            <span class="loader-spinner"></span>
            <span class="loader-text">Загрузка плейлиста...</span>
          </div>
          <div v-else-if="store.isLoadingEPG" class="header-loader">
            <span class="loader-spinner"></span>
            <span class="loader-text">Загрузка EPG...</span>
          </div>
        </div>
        
        <div class="header-right">
          <button class="add-playlist-btn" @click="selectSavedPlaylist">
            <span>+</span> Плейлист
          </button>
          
          <nav class="tabs">
            <button 
              class="tab" 
              :class="{ active: activeTab === 'player' }"
              @click="activeTab = 'player'"
            >
              Плеер
            </button>
            <button 
              class="tab" 
              :class="{ active: activeTab === 'epg' }"
              @click="activeTab = 'epg'"
            >
              Программа
            </button>
          </nav>
        </div>
      </header>
      
      <!-- Десктоп: каналы слева -->
      <div v-if="!isMobile" class="desktop-layout">
        <aside class="sidebar">
          <ChannelList @select="selectChannel" />
        </aside>
        
        <div class="content">
          <div v-if="activeTab === 'player'" class="content-player">
            <VideoPlayer />
          </div>
          
          <div v-else class="content-epg">
            <EPGViewer />
          </div>
        </div>
      </div>
      
      <!-- Мобильный: только плеер -->
      <div v-else class="content">
        <div v-if="activeTab === 'player'" class="content-player">
          <VideoPlayer />
        </div>
        
        <div v-else class="content-epg">
          <EPGViewer />
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mobile-channels-btn {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  padding: 12px 24px;
  background: var(--accent-primary);
  color: var(--bg-primary);
  font-size: 14px;
  font-weight: 600;
  border-radius: 24px;
  box-shadow: 0 4px 20px rgba(0, 229, 160, 0.3);
}

.modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-content {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  max-width: 100%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.add-modal {
  width: 100%;
  max-width: 400px;
}

@media (max-width: 480px) {
  .add-modal {
    width: 100%;
    max-width: none;
  }
  
  .modal-content {
    width: 100%;
    max-height: 85vh;
  }
}

.channel-modal {
  width: 95%;
  height: 80vh;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-header h3 {
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}

.close-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
  gap: 12px;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-loader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
}

.loader-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--bg-elevated);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loader-text {
  font-size: 13px;
  color: var(--text-secondary);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-icon {
  font-size: 20px;
}

.logo-text {
  font-size: 18px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.add-playlist-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--accent-primary);
  color: var(--bg-primary);
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--radius-md);
}

.tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-tertiary);
  padding: 4px;
  border-radius: var(--radius-md);
}

.tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

.tab.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.desktop-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.sidebar > :first-child:not(.sidebar-header):not(.sidebar-actions) {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  overflow: hidden;
}

.content-player,
.content-epg {
  height: 100%;
}

.global-loader-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.global-loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 48px;
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.loader-spinner-large {
  width: 48px;
  height: 48px;
  border: 4px solid var(--bg-tertiary);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.global-loader .loader-text {
  font-size: 16px;
  color: var(--text-secondary);
}

.epg-loader-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>