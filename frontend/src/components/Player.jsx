import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import './Player.css';

const POLL_INTERVAL_MS = 30000;
const TIMEZONE = 'America/Lima';

// Cache de URLs validadas para no re-verificar en cada ciclo
const urlStatusCache = new Map();

export default function Player() {
  const navigate = useNavigate();
  const [uuid] = useState(localStorage.getItem('tv_uuid'));
  const [noContent, setNoContent] = useState(false);
  const [waitReason, setWaitReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const imageRef = useRef(null);
  const ytContainerRef = useRef(null);
  
  const ytPlayerRef = useRef(null);
  const playbackTimeoutRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const playlistRef = useRef([]);
  const currentIndexRef = useRef(-1);
  const socketRef = useRef(null);
  
  // Estados para la playlist temporal interactiva
  const tempPlaylistRef = useRef([]);
  const tempIndexRef = useRef(0);
  const isTempModeRef = useRef(false);
  
  const playTempContentRef = useRef(null);

  // --- Utilidades de tiempo/día ---
  const normalizeText = (text) => text ? text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
  
  const getCurrentDayNormalized = () => {
    const daysMap = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const limaStr = new Date().toLocaleString("en-US", { timeZone: TIMEZONE });
    const limaDate = new Date(limaStr);
    return daysMap[limaDate.getDay()];
  };
  
  const getCurrentTimeInMinutes = () => {
    const limaStr = new Date().toLocaleString("en-US", { timeZone: TIMEZONE });
    const limaDate = new Date(limaStr);
    return limaDate.getHours() * 60 + limaDate.getMinutes();
  };
  
  const timeStringToMinutes = (timeString) => {
    if (!timeString) return -1;
    const parts = timeString.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  const extractYouTubeId = (url) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace('www.', '');
      if (host === 'youtu.be') return parsed.pathname.replace('/', '').split('?')[0] || null;
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/embed/')[1].split('/')[0] || null;
        if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/shorts/')[1].split('/')[0] || null;
        if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      }
    } catch(e){}
    return null;
  };

  const isContentPlayableNow = (content) => {
    if (!content) return false;
    const currentDay = getCurrentDayNormalized();
    const currentMinutes = getCurrentTimeInMinutes();
    let daysDB = content.days_of_week;
    let days = [];
    if (Array.isArray(daysDB)) days = daysDB.map(d => normalizeText(d));
    else if (typeof daysDB === 'string') {
      const cleanString = daysDB.replace('{', '').replace('}', '');
      cleanString.split(',').forEach(d => days.push(normalizeText(d)));
    }
    const isDayValid = days.length === 0 || days.includes(currentDay);
    const startMin = timeStringToMinutes(content.start_time);
    const endMin = timeStringToMinutes(content.end_time);
    
    if (startMin === -1 || endMin === -1) return isDayValid;
    const isTimeValid = currentMinutes >= startMin && currentMinutes < endMin;
    return isDayValid && isTimeValid;
  };

  const findNextPlayableIndex = (startIndex) => {
    const pl = playlistRef.current;
    if (!pl || pl.length === 0) return -1;
    const total = pl.length;
    for (let i = 0; i < total; i++) {
      const pointer = (startIndex + i) % total;
      if (isContentPlayableNow(pl[pointer])) return pointer;
    }
    return -1;
  };

  // --- Control de reproductores ---
  const destroyYtPlayer = () => {
    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.destroy(); } catch(e) {}
      ytPlayerRef.current = null;
    }
    if (ytContainerRef.current) {
      ytContainerRef.current.innerHTML = '';
      ytContainerRef.current.style.display = 'none';
    }
  };

  const stopAllPlayers = () => {
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.style.display = 'none';
    }
    destroyYtPlayer();
    if (iframeRef.current) {
      iframeRef.current.style.display = 'none';
      iframeRef.current.removeAttribute('src');
    }
    if (imageRef.current) {
      imageRef.current.removeAttribute('src');
      imageRef.current.style.display = 'none';
    }
    setIsLoading(false);
  };

  const playNext = useCallback(() => {
    if (isTempModeRef.current) {
      const pl = tempPlaylistRef.current;
      if (!pl || !pl.length) {
        isTempModeRef.current = false;
      } else {
        const nextIndex = (tempIndexRef.current + 1) % pl.length;
        tempIndexRef.current = nextIndex;
        if (playTempContentRef.current) {
          playTempContentRef.current(nextIndex);
        }
        return;
      }
    }

    const pl = playlistRef.current;
    if (!pl || !pl.length) return;
    const nextIndex = (currentIndexRef.current + 1) % pl.length;
    playContentAtIndex(nextIndex);
  }, []);

  const showNoContentState = useCallback(() => {
    stopAllPlayers();
    setNoContent(true);
    const limaStr = new Date().toLocaleString("en-US", { timeZone: TIMEZONE });
    const limaDate = new Date(limaStr);
    const day = getCurrentDayNormalized();
    const time = limaDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Buscar próximo horario de programación
    const pl = playlistRef.current || [];
    let nextStartTime = null;
    const currentMin = limaDate.getHours() * 60 + limaDate.getMinutes();
    for (const item of pl) {
      const itemStartMin = timeStringToMinutes(item.start_time);
      if (itemStartMin > currentMin) {
        if (!nextStartTime || itemStartMin < timeStringToMinutes(nextStartTime)) {
          nextStartTime = item.start_time;
        }
      }
    }

    let reasonMsg = `Día: ${day} | Hora: ${time}`;
    if (nextStartTime) {
      reasonMsg += ` | Próxima emisión: ${nextStartTime}`;
    }
    setWaitReason(reasonMsg);
    
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    playbackTimeoutRef.current = setTimeout(() => {
      playContentAtIndex(0);
    }, 60000);
  }, []);

  const playYouTube = (videoId, duration) => {
    destroyYtPlayer();
    if (!ytContainerRef.current) return;
    ytContainerRef.current.style.display = 'block';
    
    const placeholder = document.createElement('div');
    placeholder.id = 'yt-player-' + Date.now();
    ytContainerRef.current.appendChild(placeholder);
    
    let isPlayingOrEnded = false;
    // Cap safe duration for YouTube Shorts/URLs to 60s max unless specified shorter
    const safeDuration = (duration && duration > 0 && duration <= 300) ? duration : 60;

    const watchdog = setTimeout(() => {
      if (!isPlayingOrEnded) {
        playNext();
      }
    }, 8000);

    const checkYT = setInterval(() => {
      if (window.YT && window.YT.Player) {
        clearInterval(checkYT);
        try {
          ytPlayerRef.current = new window.YT.Player(placeholder.id, {
            width: '100%',
            height: '100%',
            videoId: videoId,
            host: 'https://www.youtube.com',
            playerVars: {
              autoplay: 1,
              mute: 1,
              controls: 0,
              rel: 0,
              modestbranding: 1,
              iv_load_policy: 3,
              disablekb: 1,
              fs: 0,
              playsinline: 1,
              enablejsapi: 1,
              origin: window.location.origin
            },
            events: {
              onReady: (e) => {
                try { e.target.playVideo(); } catch(e) {}
                setIsLoading(false);
              },
              onError: () => {
                clearTimeout(watchdog);
                playNext();
              },
              onStateChange: (e) => {
                if (e.data === 1) { // PLAYING
                  isPlayingOrEnded = true;
                  clearTimeout(watchdog);
                  setIsLoading(false);
                } else if (e.data === 0) { // ENDED
                  isPlayingOrEnded = true;
                  clearTimeout(watchdog);
                  playNext();
                }
              }
            }
          });
        } catch(e) {
          clearTimeout(watchdog);
          playNext();
        }
      }
    }, 200);

    const isFullVideo = duration === 0;
    if (!isFullVideo) {
      playbackTimeoutRef.current = setTimeout(() => {
        clearTimeout(watchdog);
        playNext();
      }, safeDuration * 1000);
    }
  };

  const playContentAtIndex = async (index) => {
    stopAllPlayers();

    let validIndex = index;
    const pl = playlistRef.current;
    
    if (!pl || pl.length === 0) {
      showNoContentState();
      return;
    }

    if (index === -1 || !isContentPlayableNow(pl[index])) {
      const searchStart = (index === -1) ? 0 : (index + 1) % pl.length;
      validIndex = findNextPlayableIndex(searchStart);
    }

    if (validIndex === -1) {
      showNoContentState();
      return;
    }

    currentIndexRef.current = validIndex;
    const content = pl[validIndex];

    let finalSourceUrl = content.source_url;
    if (content.source_type === 'local_file' && !finalSourceUrl.startsWith('http')) {
      finalSourceUrl = window.location.origin + finalSourceUrl;
    }

    let type = content.content_type || 'url';
    if (content.source_type === 'local_file') {
      if (finalSourceUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) type = 'image';
      else if (finalSourceUrl.match(/\.(mp4|webm|mkv|mov)$/i)) type = 'video';
    }

    // Contenido válido confirmado: apagar pantalla de "Esperando programación"
    setNoContent(false);
    setIsLoading(true);

    switch (type) {
      case 'video':
        if (videoRef.current) {
          videoRef.current.style.display = 'block';
          videoRef.current.src = finalSourceUrl;
          videoRef.current.muted = false;
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.play().catch(() => {
                  playNext();
                });
              }
            });
          }
        }
        break;

      case 'image':
        if (imageRef.current) {
          imageRef.current.style.display = 'block';
          imageRef.current.src = finalSourceUrl;
          setIsLoading(false);
        }
        const imgDuration = (content.duration_seconds && content.duration_seconds > 0) ? content.duration_seconds : 15;
        playbackTimeoutRef.current = setTimeout(playNext, imgDuration * 1000);
        break;

      default: {
        const ytId = extractYouTubeId(finalSourceUrl);
        if (ytId) {
          playYouTube(ytId, content.duration_seconds);
        } else {
          if (iframeRef.current) {
            iframeRef.current.style.display = 'block';
            iframeRef.current.src = finalSourceUrl;
            setIsLoading(false);
          }
          const iframeDuration = (content.duration_seconds && content.duration_seconds > 0 && content.duration_seconds <= 300) ? content.duration_seconds : 30;
          playbackTimeoutRef.current = setTimeout(playNext, iframeDuration * 1000);
        }
        break;
      }
    }
  };

  playTempContentRef.current = (index) => {
    stopAllPlayers();
    
    const pl = tempPlaylistRef.current;
    if (!pl || pl.length === 0) {
      isTempModeRef.current = false;
      playNext();
      return;
    }

    const content = pl[index];
    if (!content) return;

    let finalSourceUrl = content.content_url;
    if (finalSourceUrl.startsWith('/media/')) {
      finalSourceUrl = window.location.origin + finalSourceUrl;
    }

    let type = 'url';
    if (finalSourceUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) type = 'image';
    else if (finalSourceUrl.match(/\.(mp4|webm|mkv|mov)$/i)) type = 'video';

    setNoContent(false);
    setIsLoading(true);

    const isFullVideo = content.duration === 0;
    const safeDuration = content.duration || 30;

    switch (type) {
      case 'video':
        if (videoRef.current) {
          videoRef.current.style.display = 'block';
          videoRef.current.src = finalSourceUrl;
          videoRef.current.muted = false;
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.play().catch(() => playNext());
              }
            });
          }
          // Si es Full Video, onEnded() (configurado en el JSX) será el único encargado de avanzar
          if (!isFullVideo) {
            playbackTimeoutRef.current = setTimeout(playNext, safeDuration * 1000);
          }
        }
        break;

      case 'image':
        if (imageRef.current) {
          imageRef.current.style.display = 'block';
          imageRef.current.src = finalSourceUrl;
          setIsLoading(false);
        }
        // Las imágenes siempre necesitan un timeout, no pueden durar "infinito" a menos que sea a propósito, 
        // pero fallbackearemos a safeDuration o 15 si intentan poner duration 0 a una imagen.
        playbackTimeoutRef.current = setTimeout(playNext, (isFullVideo ? 15 : safeDuration) * 1000);
        break;

      default: {
        const ytId = extractYouTubeId(finalSourceUrl);
        if (ytId) {
          playYouTube(ytId, content.duration);
        } else {
          if (iframeRef.current) {
            iframeRef.current.style.display = 'block';
            iframeRef.current.src = finalSourceUrl;
            setIsLoading(false);
          }
          if (!isFullVideo) {
            playbackTimeoutRef.current = setTimeout(playNext, safeDuration * 1000);
          }
        }
        break;
      }
    }
  };

  // --- Efecto principal ---
  useEffect(() => {
    if (!uuid) {
      navigate('/login');
      return;
    }

    // Suprimir errores y warnings de postMessage de YouTube (inherentes a la API en http://)
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const ytFilter = (msg) => {
      const s = typeof msg === 'string' ? msg : msg?.toString?.() || '';
      return s.includes('postMessage') || s.includes('youtube') || s.includes('youtube-nocookie');
    };
    console.error = (...args) => {
      if (ytFilter(args[0])) return;
      originalConsoleError.apply(console, args);
    };
    console.warn = (...args) => {
      if (ytFilter(args[0])) return;
      originalConsoleWarn.apply(console, args);
    };

    const initYouTubeApi = () => {
      if (!window.YT) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        document.body.appendChild(script);
      }
    };
    initYouTubeApi();

    const fetchPlaylist = async () => {
      try {
        const res = await axios.get(`/api/tv/${uuid}/playlist?t=${Date.now()}`);
        return res.data.playlist || [];
      } catch (err) {
        return [];
      }
    };

    const checkForUpdates = async () => {
      const newPlaylist = await fetchPlaylist();
      if (JSON.stringify(newPlaylist) !== JSON.stringify(playlistRef.current)) {
        playlistRef.current = newPlaylist;
        urlStatusCache.clear(); // Limpiar cache al actualizar playlist
        if (currentIndexRef.current === -1) {
          playContentAtIndex(0);
        }
      }
    };

    const init = async () => {
      setIsLoading(true);
      const initialPlaylist = await fetchPlaylist();
      playlistRef.current = initialPlaylist;

      if (initialPlaylist.length > 0) {
        playContentAtIndex(0);
      } else {
        showNoContentState();
      }

      pollIntervalRef.current = setInterval(checkForUpdates, POLL_INTERVAL_MS);
      
      // === MINI AGENTE: Conexión WebSocket para control remoto ===
      if (!socketRef.current) {
        // Al no pasar URL, io() asume el mismo host y puerto de window.location (ej: puerto 80)
        // Y como nginx está configurado para proxear /socket.io/ hacia backend:3002, funcionará remoto.
        socketRef.current = io({ path: '/socket.io' });
        socketRef.current.on('connect', () => {
          socketRef.current.emit('register_tv', { tv_uuid: uuid });
        });
        
        socketRef.current.on('TEMP_CMD', async (data) => {
          console.log('⚡ [MINI AGENTE] Comando interactivo temporal recibido:', data);
          const { command, startIndex } = data;

          if (command === 'STOP') {
            isTempModeRef.current = false;
            tempPlaylistRef.current = [];
            stopAllPlayers();
            if (playlistRef.current.length > 0) {
              playContentAtIndex(0);
            } else {
              showNoContentState();
            }
          } else if (command === 'PAUSE') {
            if (videoRef.current) videoRef.current.pause();
            if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === 'function') {
              try { ytPlayerRef.current.pauseVideo(); } catch(e){}
            }
          } else if (command === 'PLAY') {
            try {
              // Obtener la playlist temporal más reciente de SQLite
              const res = await axios.get(`/api/admin/temp-playlist/${uuid}`);
              if (res.data && res.data.success && res.data.playlist.length > 0) {
                tempPlaylistRef.current = res.data.playlist;
                isTempModeRef.current = true;
                tempIndexRef.current = startIndex || 0;
                
                if (videoRef.current && videoRef.current.paused && videoRef.current.src) {
                  // ignorar reanudación limpia, forzar play
                }
                
                playTempContentRef.current(tempIndexRef.current);
              }
            } catch (err) {
              console.error('Error obteniendo playlist temporal:', err);
            }
          }
        });

        socketRef.current.on('TEMP_UPDATED', async () => {
          if (isTempModeRef.current) {
            try {
              const res = await axios.get(`/api/admin/temp-playlist/${uuid}`);
              if (res.data && res.data.success && res.data.playlist.length > 0) {
                tempPlaylistRef.current = res.data.playlist;
                console.log('⚡ [MINI AGENTE] Tiempos actualizados en caliente');
              }
            } catch (err) {
              console.error('Error recargando playlist temporal:', err);
            }
          }
        });
      }
    };

    init();

    return () => {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      stopAllPlayers();
    };
  }, [uuid, navigate]);

  const handleLogout = () => {
    localStorage.removeItem('tv_uuid');
    navigate('/login');
  };

  const handleMediaError = () => {
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    playbackTimeoutRef.current = setTimeout(playNext, 500);
  };

  return (
    <div className="player-body">
      <div className="header-logo">Nexus TV</div>
      <button className="logout-btn" onClick={handleLogout}>Cerrar Sesión</button>
      <div className="footer-uuid">{uuid}</div>

      <div className="dashboard-container">
        <div className="dashboard-content active">
          <div id="player-section">
            {isLoading && <div id="loader"></div>}
            
            <video 
              ref={videoRef} 
              id="video-player" 
              playsInline 
              muted 
              onEnded={playNext}
              onError={handleMediaError}
              onWaiting={() => setIsLoading(true)}
              onPlaying={() => setIsLoading(false)}
              onLoadStart={() => setIsLoading(true)}
            ></video>
            
            <div ref={ytContainerRef} id="yt-container" style={{display: 'none'}}></div>
            
            <iframe ref={iframeRef} id="iframe-player" style={{display: 'none'}} frameBorder="0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"></iframe>
            
            <img ref={imageRef} id="image-player" style={{display: 'none'}} alt="Content" onError={handleMediaError} />

            <div id="no-content" style={{ display: noContent ? 'flex' : 'none' }}>
              <div className="no-content-inner">
                <div className="loading-spinner"></div>
                <h2>NEXUS TV</h2>
                <p>Buscando nuevo contenido...</p>
                <small>{waitReason}</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
