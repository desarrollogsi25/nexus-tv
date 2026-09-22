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

    return (
        <div className="admin-layout">
            <aside className="admin-sidebar">
                <div className="sidebar-header">
                    <h1>Nexus TV</h1>
                    <p>Panel de Control</p>
                </div>
                <nav className="sidebar-nav">
                    <Link to="/admin" className={location.pathname === '/admin' ? 'active' : ''}>
                        📺 Pantallas
                    </Link>
                    <Link to="/admin/register" className={location.pathname === '/admin/register' ? 'active' : ''}>
                        🔐 Dispositivos Pendientes
                    </Link>
                    <Link to="/admin/tickets" className={location.pathname === '/admin/tickets' ? 'active' : ''}>
                        🎫 Turnos
                    </Link>
                    <Link to="/admin/content" className={location.pathname === '/admin/content' ? 'active' : ''}>
                        📂 Contenido & Playlists
                    </Link>
                </nav>
            </aside>
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
    );
};

export default Admin;
