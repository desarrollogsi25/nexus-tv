import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Admin.css';

const Admin = () => {
  const [tvs, setTvs] = useState([]);
  const [selectedTv, setSelectedTv] = useState(null);
  
  // Playlist states
  const [tempPlaylist, setTempPlaylist] = useState([]);
  const [normalPlaylist, setNormalPlaylist] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [editDuration, setEditDuration] = useState('');
  
  // Form states
  const [contentUrl, setContentUrl] = useState('');
  const [duration, setDuration] = useState(30);
  const [fileToUpload, setFileToUpload] = useState(null);
  
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchTvs = async () => {
    try {
      const res = await fetch('/api/admin/tvs');
      const data = await res.json();
      if (data.success) {
        setTvs(data.tvs);
      }
    } catch (err) {
      console.error('Error fetching TVs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTempPlaylist = async (uuid) => {
    try {
      const res = await fetch(`/api/admin/temp-playlist/${uuid}`);
      const data = await res.json();
      if (data.success) {
        setTempPlaylist(data.playlist);
      }
    } catch (err) {
      console.error('Error fetching temp playlist:', err);
    }
  };

  const fetchNormalPlaylist = async (uuid) => {
    try {
      const res = await fetch(`/api/tv/${uuid}/playlist?t=${Date.now()}`);
      const data = await res.json();
      if (data.playlist) {
        setNormalPlaylist(data.playlist);
      }
    } catch (err) {
      console.error('Error fetching normal playlist:', err);
    }
  };

  useEffect(() => {
    fetchTvs();
    const interval = setInterval(fetchTvs, 5000); 
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedTv) {
      fetchTempPlaylist(selectedTv.tv_uuid);
      fetchNormalPlaylist(selectedTv.tv_uuid);
    } else {
      setTempPlaylist([]);
      setNormalPlaylist([]);
      setShowAddForm(false);
    }
  }, [selectedTv]);

  const handleAddVideo = async (e) => {
    e.preventDefault();
    if (!selectedTv || (!contentUrl && !fileToUpload)) {
      showMessage('⚠️ Provee una URL o un archivo.', 'error');
      return;
    }

    try {
      let finalUrl = contentUrl;
      let finalDuration = duration;

      if (fileToUpload) {
        showMessage('⏳ Subiendo archivo...', 'info');
        const formData = new FormData();
        formData.append('mediaFile', fileToUpload);
        
        const uploadRes = await fetch('/api/tv-content/upload', {
          method: 'POST',
          body: formData
        });
        const uploadData = await uploadRes.json();
        
        if (uploadData.publicUrl) {
          finalUrl = uploadData.publicUrl;
          if (uploadData.duration) {
             finalDuration = uploadData.duration;
          }
        } else {
          showMessage('❌ Error al subir el archivo.', 'error');
          return;
        }
      }

      const res = await fetch('/api/admin/temp-playlist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tv_uuid: selectedTv.tv_uuid,
          content_url: finalUrl,
          duration: parseInt(finalDuration, 10)
        })
      });
      const data = await res.json();
      if (data.success) {
        showMessage('✅ Video añadido a la playlist temporal', 'success');
        setContentUrl('');
        setFileToUpload(null);
        if (document.getElementById('file-upload-input')) {
          document.getElementById('file-upload-input').value = '';
        }
        setShowAddForm(false);
        fetchTempPlaylist(selectedTv.tv_uuid);
      } else {
        showMessage('❌ Error: ' + data.message, 'error');
      }
    } catch (err) {
      showMessage('❌ Error de conexión.', 'error');
    }
  };

  const handleCommand = async (command, index = 0) => {
    if (!selectedTv) return;
    try {
      const res = await fetch('/api/admin/temp-playlist/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tv_uuid: selectedTv.tv_uuid,
          command: command,
          index: index
        })
      });
      const data = await res.json();
      if (data.success) {
        if (command === 'STOP') showMessage('⏹️ Playlist detenida.', 'info');
        else if (command === 'PAUSE') showMessage('⏸️ Video pausado.', 'info');
        else showMessage('▶️ Reproduciendo video.', 'success');
      } else {
        showMessage('❌ Error: ' + data.message, 'error');
      }
    } catch (err) {
      showMessage('❌ Error enviando comando.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("¿Seguro que deseas eliminar este video de la playlist temporal?")) return;
    try {
      const res = await fetch(`/api/admin/temp-playlist/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchTempPlaylist(selectedTv.tv_uuid);
      } else {
        showMessage('❌ Error: ' + data.message, 'error');
      }
    } catch (err) {
      showMessage('❌ Error eliminando video.', 'error');
    }
  };

  const showMessage = (msg, type = 'info') => {
    setMessage({ text: msg, type });
    setTimeout(() => setMessage(''), 4000);
  };

  const handleUpdateDuration = async (id, newDuration) => {
    try {
      const res = await fetch(`/api/admin/temp-playlist/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: newDuration })
      });
      const data = await res.json();
      if (data.success) {
        showMessage('✅ Duración actualizada', 'success');
        fetchTempPlaylist(selectedTv.tv_uuid);
      } else {
        showMessage('❌ Error: ' + data.message, 'error');
      }
    } catch (err) {
      showMessage('❌ Error de conexión.', 'error');
    }
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

  const formatVideoName = (url) => {
    try {
      if (url.includes('youtube.com') || url.includes('youtu.be')) return 'Video de YouTube';
      const name = url.split('/').pop();
      return name.length > 25 ? name.substring(0, 25) + '...' : name;
    } catch {
      return 'Contenido';
    }
  };

  return (
    <div className="admin-body">
      <div className="admin-container">
        <header className="admin-header">
          <h1>Nexus TV <span>Admin Console</span></h1>
          <button className="back-btn" onClick={() => navigate('/login')}>Salir</button>
        </header>

        <div className="admin-grid">
          {/* Panel Izquierdo: Lista de TVs */}
          <div className="panel tv-list-panel">
            <h2>Pantallas Conectadas</h2>
            {loading ? (
              <p className="loading-text">Cargando...</p>
            ) : (
              <ul className="tv-list">
                {tvs.map((tv) => (
                  <li 
                    key={tv.tv_uuid} 
                    className={`tv-item ${selectedTv?.tv_uuid === tv.tv_uuid ? 'selected' : ''}`}
                    onClick={() => setSelectedTv(tv)}
                  >
                    <div className="tv-info">
                      <strong>{tv.name}</strong>
                      <span className="uuid-sub">{tv.tv_uuid.substring(0, 8)}...</span>
                    </div>
                    <div className={`status-badge ${tv.online ? 'online' : 'offline'}`}>
                      {tv.online ? 'Online' : 'Offline'}
                    </div>
                  </li>
                ))}
                {tvs.length === 0 && <p className="no-tvs">No hay pantallas registradas.</p>}
              </ul>
            )}
          </div>

          {/* Panel Derecho: Playlist Temporal Interactiva */}
          <div className="panel control-panel">
            <div className="playlist-header">
              <h2>Playlist Temporal</h2>
              <button 
                className="stop-playlist-btn"
                onClick={() => handleCommand('STOP')}
                disabled={!selectedTv || !selectedTv.online}
              >
                ⏹️ Detener Playlist
              </button>
            </div>
            
            <p className="panel-desc">
              Estos videos ignoran la programación normal. Se reproducen solo cuando presionas Play.
            </p>

            {!selectedTv ? (
              <div className="selected-tv-display text-center" style={{marginTop: '2rem'}}>
                Selecciona una TV de la lista para ver su playlist.
              </div>
            ) : (
              <div className="playlist-content">
                
                {/* Lista de Videos */}
                <div className="video-list">
                  {tempPlaylist.length === 0 ? (
                    <p className="empty-playlist">La playlist temporal está vacía.</p>
                  ) : (
                    tempPlaylist.map((item, index) => {
                      const ytId = extractYouTubeId(item.content_url);
                      const isExpanded = expandedRowId === item.id;
                      const isFull = item.duration === 0;

                      return (
                        <div className={`video-row ${isExpanded ? 'expanded' : ''}`} key={item.id}>
                          <div className="video-row-main" onClick={() => {
                            if (isExpanded) {
                              setExpandedRowId(null);
                            } else {
                              setExpandedRowId(item.id);
                              setEditDuration(item.duration);
                            }
                          }}>
                            <div className="video-name">
                              <span className="video-index">{index + 1}.</span>
                              <span className="video-title">{formatVideoName(item.content_url)}</span>
                              <span className={`video-duration ${isFull ? 'full-duration' : ''}`}>
                                {isFull ? 'Completo' : `${item.duration}s`}
                              </span>
                            </div>
                            <div className="video-controls" onClick={(e) => e.stopPropagation()}>
                              <button className="ctrl-btn play-btn" onClick={() => handleCommand('PLAY', index)} title="Reproducir">▶️</button>
                              <button className="ctrl-btn pause-btn" onClick={() => handleCommand('PAUSE')} title="Pausar">⏸️</button>
                              <button 
                                className="ctrl-btn edit-btn" 
                                onClick={() => {
                                  if (isExpanded) setExpandedRowId(null);
                                  else {
                                    setExpandedRowId(item.id);
                                    setEditDuration(item.duration);
                                  }
                                }} 
                                title="Editar Duración/Miniatura"
                              >
                                ✏️
                              </button>
                              <button className="ctrl-btn delete-btn" onClick={() => handleDelete(item.id)} title="Eliminar">🔴</button>
                            </div>
                          </div>
                          
                          {/* Área Expandida: Vista Previa y Edición */}
                          {isExpanded && (
                            <div className="video-row-details">
                              <div className="video-preview-box">
                                {ytId ? (
                                  <img src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`} alt="Thumbnail" className="video-thumbnail" />
                                ) : item.content_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                  <img src={item.content_url.startsWith('http') ? item.content_url : `/api${item.content_url}`} alt="Thumbnail" className="video-thumbnail" />
                                ) : (
                                  <video src={item.content_url.startsWith('http') ? item.content_url : `/api${item.content_url}`} className="video-thumbnail" muted />
                                )}
                              </div>
                              <div className="video-edit-box">
                                <h4>Ajustar Duración</h4>
                                <div className="edit-duration-controls">
                                  <input 
                                    type="number" 
                                    min="1" 
                                    value={editDuration === 0 ? '' : editDuration} 
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setEditDuration(val === '' ? '' : parseInt(val));
                                    }}
                                    disabled={editDuration === 0}
                                    className="admin-input small-input"
                                    placeholder="Ej: 30"
                                  />
                                  <span>segundos</span>
                                  <button 
                                    className="save-duration-btn" 
                                    onClick={() => handleUpdateDuration(item.id, editDuration === '' ? 30 : editDuration)}
                                  >
                                    Guardar
                                  </button>
                                </div>
                                <div className="full-video-toggle">
                                  <button 
                                    className={`full-video-btn ${editDuration === 0 ? 'active' : ''}`}
                                    onClick={() => {
                                      const newDuration = editDuration === 0 ? 30 : 0;
                                      setEditDuration(newDuration);
                                      handleUpdateDuration(item.id, newDuration);
                                    }}
                                  >
                                    🎬 {editDuration === 0 ? 'Video Completo Activado' : 'Reproducir video completo'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Botón de Agregar (Sketch 1) */}
                {!showAddForm ? (
                  <button className="add-video-btn" onClick={() => setShowAddForm(true)}>
                    + Agregar Video
                  </button>
                ) : (
                  /* Formulario de Agregar (Sketch 2) */
                  <form onSubmit={handleAddVideo} className="push-form add-form-box">
                    <div className="form-header">
                      <h3>Nuevo Contenido</h3>
                      <button type="button" className="close-form-btn" onClick={() => setShowAddForm(false)}>✖</button>
                    </div>

                    <div className="form-group">
                      <label>URL del Contenido (YouTube o URL web):</label>
                      <input 
                        type="text" 
                        value={contentUrl}
                        onChange={(e) => { setContentUrl(e.target.value); setFileToUpload(null); if(document.getElementById('file-upload-input')) document.getElementById('file-upload-input').value=''; }}
                        placeholder="Ej: https://www.youtube.com/watch?v=..."
                        className="admin-input"
                        disabled={!!fileToUpload}
                      />
                    </div>

                    <div className="form-group text-center">
                      <span className="or-divider">O SUBE UN ARCHIVO DESDE TU PC</span>
                    </div>

                    <div className="form-group">
                      <label>Subir Imagen o Video Local:</label>
                      <input 
                        id="file-upload-input"
                        type="file" 
                        accept="image/*,video/*"
                        onChange={(e) => { setFileToUpload(e.target.files[0]); setContentUrl(''); }}
                        className="admin-input file-input"
                      />
                    </div>

                    <div className="form-group">
                      <label>Duración en pantalla (segundos):</label>
                      <input 
                        type="number" 
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        min="5"
                        className="admin-input duration-input"
                      />
                    </div>

                    <button 
                      type="submit" 
                      className="push-btn" 
                      disabled={!selectedTv.online}
                    >
                      Añadir a la Playlist
                    </button>
                  </form>
                )}
              </div>
            )}

            {message.text && (
              <div className={`admin-message ${message.type}`}>
                {message.text}
              </div>
            )}

            {/* SECCIÓN PLAYLIST NORMAL */}
            {selectedTv && (
              <div className="playlist-content" style={{marginTop: '3rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem'}}>
                <div className="playlist-header">
                  <h2>Programación Normal (Automática)</h2>
                </div>
                <p className="panel-desc">Estos videos se reproducen según el horario programado cuando la Playlist Temporal está detenida o vacía.</p>
                <div className="video-list">
                  {normalPlaylist.length === 0 ? (
                    <p className="empty-playlist">No hay programación normal configurada para esta TV.</p>
                  ) : (
                    normalPlaylist.map((item, index) => {
                      const ytId = extractYouTubeId(item.source_url);
                      return (
                        <div className="video-row" key={index} style={{opacity: 0.8}}>
                          <div className="video-row-main" style={{cursor: 'default'}}>
                            <div className="video-name">
                              <span className="video-index">{index + 1}.</span>
                              <span className="video-title">{formatVideoName(item.source_url)}</span>
                              <span className="video-duration">{item.duration_seconds}s</span>
                            </div>
                            <div className="video-controls">
                              <span style={{fontSize: '0.8rem', color: '#64748b', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px'}}>
                                {item.start_time ? `${item.start_time} - ${item.end_time}` : 'Todo el día'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;
