import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Login.css';

export default function Login() {
  const [uuid, setUuid] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });
  const navigate = useNavigate();

  useEffect(() => {
    const storedUuid = localStorage.getItem('tv_uuid');
    if (storedUuid) {
      navigate('/player');
    }
  }, [navigate]);

  const showMessage = (text, type = 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!uuid.trim()) {
      showMessage('Por favor, ingresa el UUID de tu TV.');
      return;
    }
    try {
      const response = await axios.post('/api/login', { tv_uuid: uuid.trim() });
      if (response.data.success) {
        localStorage.setItem('tv_uuid', uuid.trim());
        navigate('/player');
      } else {
        showMessage(response.data.message);
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMsg = error.response?.data?.message || 'No se pudo conectar al servidor. Intenta de nuevo más tarde.';
      showMessage(errorMsg);
    }
  };

  return (
    <div className="login-body">
      <div id="message-box" className={message.text ? 'show' : ''} style={{ backgroundColor: message.type === 'success' ? '#2f855a' : '#c53030' }}>
        {message.text}
      </div>

      <div id="login-container" className="container form-container show">
        <h1 className="logo">Nexus TV</h1>
        <p className="tagline">Ingresa el UUID de tu TV para empezar.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <input 
              type="text" 
              placeholder="UUID de la TV" 
              value={uuid}
              onChange={(e) => setUuid(e.target.value)}
              required 
            />
          </div>
          <button type="submit" className="submit-btn">Iniciar Sesión</button>
        </form>
      </div>
    </div>
  );
}
