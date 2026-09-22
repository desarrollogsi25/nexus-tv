import React, { useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import TVList from './admin/TVList';
import TVControl from './admin/TVControl';
import TVRegister from './admin/TVRegister';
import TicketPanel from './admin/TicketPanel';
import ContentManager from './admin/ContentManager';
import './Admin.css';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

const Admin = () => {
    const location = useLocation();

    const getPageTitle = () => {
        const path = location.pathname;
        if (path === '/admin') return '📺 Gestor de Pantallas';
        if (path === '/admin/register') return '🔐 Dispositivos Pendientes';
        if (path === '/admin/tickets') return '🎫 Gestor de Turnos';
        if (path === '/admin/content') return '📂 Biblioteca de Contenidos & Playlists';
        if (path.startsWith('/admin/tv/')) return '⚙️ Configuración y Control Remoto';
        return 'Panel de Control';
    };

    return (
        <div className="admin-layout">
            <aside className="admin-sidebar">
                <div className="sidebar-header">
                    <div className="brand-badge">
                        <span className="brand-dot"></span>
                        <span className="brand-name">NEXUS TV</span>
                    </div>
                    <p className="brand-sub">Control Center v2.0</p>
                </div>
                <nav className="sidebar-nav">
                    <Link to="/admin" className={location.pathname === '/admin' ? 'active' : ''}>
                        <span className="nav-icon">📺</span>
                        <span className="nav-label">Pantallas</span>
                    </Link>
                    <Link to="/admin/register" className={location.pathname === '/admin/register' ? 'active' : ''}>
                        <span className="nav-icon">🔐</span>
                        <span className="nav-label">Dispositivos Pendientes</span>
                    </Link>
                    <Link to="/admin/tickets" className={location.pathname === '/admin/tickets' ? 'active' : ''}>
                        <span className="nav-icon">🎫</span>
                        <span className="nav-label">Turnos</span>
                    </Link>
                    <Link to="/admin/content" className={location.pathname === '/admin/content' ? 'active' : ''}>
                        <span className="nav-icon">📂</span>
                        <span className="nav-label">Contenido & Playlists</span>
                    </Link>
                </nav>
                <div className="sidebar-footer">
                    <div className="system-status">
                        <span className="status-ping"></span>
                        <span>Servidor Conectado</span>
                    </div>
                    <div className="version-info">Enterprise Web Edition</div>
                </div>
            </aside>
            <div className="admin-container">
                <header className="admin-topbar">
                    <div className="topbar-title">{getPageTitle()}</div>
                    <div className="topbar-right">
                        <span className="topbar-chip">🟢 Sistema Online</span>
                        <span className="topbar-date">{new Date().toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    </div>
                </header>
                <main className="admin-main">
                    <Routes>
                        <Route path="/" element={<TVList />} />
                        <Route path="/tv/:uuid" element={<TVControl />} />
                        <Route path="/register" element={<TVRegister />} />
                        <Route path="/tickets" element={<TicketPanel />} />
                        <Route path="/content" element={<ContentManager />} />
                    </Routes>
                </main>
            </div>
        </div>
    );
};

export default Admin;
