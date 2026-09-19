// =================================================================
// API Unificada para Nexus TV (OPTIMIZADA PARA BUCLE)
// =================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
const port = 3002;

// Configuración de la conexión a la base de datos PostgreSQL
const pool = new Pool({
    user: 'tv',
    host: '10.10.40.248',
    database: 'nexus_tv',
    password: 'Gs1$2099Dr#24zXcv',
    port: 5432,
});

const mediaDirectory = process.env.MEDIA_DIR || path.join(__dirname, 'media');

app.use(cors());
app.use(express.json());
if (!fs.existsSync(mediaDirectory)) {
    fs.mkdirSync(mediaDirectory, { recursive: true });
}

// Configuración Base de Datos SQLite (Contenido Temporal)
const sqliteDbPath = path.join(__dirname, 'nexus_temp.db');
const sqliteDb = new sqlite3.Database(sqliteDbPath, (err) => {
    if (err) console.error('❌ Error al abrir SQLite:', err.message);
    else {
        sqliteDb.run(`CREATE TABLE IF NOT EXISTS temp_content (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tv_uuid TEXT,
            content_url TEXT,
            duration INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// Estado de TVs conectadas en tiempo real (Socket.io)
const connectedTVs = new Map();

io.on('connection', (socket) => {
    socket.on('register_tv', (data) => {
        const { tv_uuid } = data;
        if (tv_uuid) {
            socket.join(tv_uuid);
            connectedTVs.set(tv_uuid, { socketId: socket.id, lastSeen: Date.now() });
            console.log(`📺 TV Registrada (Online): ${tv_uuid}`);
        }
    });

    socket.on('disconnect', () => {
        for (const [uuid, info] of connectedTVs.entries()) {
            if (info.socketId === socket.id) {
                connectedTVs.delete(uuid);
                console.log(`📺 TV Desconectada (Offline): ${uuid}`);
                break;
            }
        }
    });
});

// Middleware para servir archivos de media con fallback SVG
const mediaStatic = express.static(mediaDirectory, {
    etag: false,
    lastModified: false,
    cacheControl: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
    }
});

app.use('/media', (req, res, next) => {
    const requestedFile = req.path.replace(/^\//, '');
    const filePath = path.join(mediaDirectory, requestedFile);
    
    if (!requestedFile || !fs.existsSync(filePath)) {
        // Archivo no encontrado: devolver 404 para que el frontend dispare onError y salte rápido
        return res.status(404).json({ error: 'Not found' });
    }
    // Archivo existe: servir normalmente sin cache
    return mediaStatic(req, res, next);
});


const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, mediaDirectory);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- Endpoints ---

app.get('/api/status', (req, res) => {
    res.status(200).json({ status: 'online', message: 'Nexus TV API is running.' });
});

app.post('/api/login', async (req, res) => {
    const { tv_uuid } = req.body;
    if (!tv_uuid) return res.status(400).json({ success: false, message: 'UUID no proporcionado.' });

    try {
        const query = 'SELECT name FROM nexus_tv.tv_screens WHERE tv_uuid = $1';
        const result = await pool.query(query, [tv_uuid]);

        if (result.rows.length > 0) {
            res.status(200).json({ success: true, message: 'Inicio de sesión exitoso.', tv_name: result.rows[0].name });
        } else {
            res.status(401).json({ success: false, message: 'UUID no válido.' });
        }
    } catch (err) {
        console.error('Error de base de datos:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// === ENDPOINT DE PLAYLIST (BUCLE ACTIVADO) ===
app.get('/api/tv/:tv_uuid/playlist', async (req, res) => {
    const { tv_uuid } = req.params;

    if (!tv_uuid) {
        return res.status(400).json({ success: false, message: 'UUID de TV no proporcionado.' });
    }

    // Headers anti-caché para asegurar cambios en tiempo real
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // === CONSULTA PARA BUCLE INFINITO ===
    // 1. Filtra por UUID.
    // 2. Filtra por DÍA actual (usando la lógica de BD).
    // 3. NO filtra por hora estricta (end_time), para permitir que el cliente
    //    reciba la lista completa y pueda volver al inicio si es necesario.
    
    const query = `
        SELECT pc.start_time, pc.end_time, pc.days_of_week,
               c.source_url, c.source_type, c.content_type, c.duration_seconds
        FROM nexus_tv.tv_screens AS ts
        JOIN nexus_tv.tv_playlist AS tp ON ts.id = tp.tv_id
        JOIN nexus_tv.playlists AS p ON tp.playlist_id = p.id
        JOIN nexus_tv.playlist_content AS pc ON p.id = pc.playlist_id
        JOIN nexus_tv.content AS c ON pc.content_id = c.id
        WHERE ts.tv_uuid = $1
        
        -- FILTRO DE DÍA: Solo carga el contenido programado para HOY
        AND pc.days_of_week @> ARRAY[
            CASE EXTRACT(ISODOW FROM CURRENT_DATE)
                WHEN 1 THEN 'lunes'
                WHEN 2 THEN 'martes'
                WHEN 3 THEN 'miércoles'
                WHEN 4 THEN 'jueves'
                WHEN 5 THEN 'viernes'
                WHEN 6 THEN 'sábado'
                WHEN 7 THEN 'domingo'
            END
        ]::text[]

        -- NOTA: Hemos quitado el filtro "AND pc.end_time >= CURRENT_TIME" 
        -- para que la playlist contenga TODOS los elementos del día.
        -- Esto permite que el reproductor vuelva a empezar (bucle) si llega al final.

        ORDER BY pc.start_time ASC;
    `;

    try {
        const result = await pool.query(query, [tv_uuid]);
        res.status(200).json({ success: true, playlist: result.rows });
    } catch (err) {
        console.error("❌ Error en DB:", err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// --- Gestión de Contenido ---

app.post('/api/tv-content/upload', upload.single('mediaFile'), (req, res) => {
    if (!req.file) return res.status(400).send('No se ha subido ningún archivo.');

    ffmpeg.ffprobe(req.file.path, (err, metadata) => {
        const publicUrl = `/media/${req.file.filename}`;
        if (err) {
            console.error("Error metadata:", err);
            return res.status(200).json({ publicUrl: publicUrl, duration: null });
        }
        const duration = Math.round(metadata.format.duration);
        res.status(200).json({ publicUrl: publicUrl, duration: duration });
    });
});

app.post('/api/tv-content/delete', (req, res) => {
    const { fileUrl } = req.body;
    if (!fileUrl) return res.status(400).json({ success: false, message: 'Falta URL.' });
    
    try {
        const fileName = path.basename(fileUrl);
        const filePath = path.join(mediaDirectory, fileName);
        if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
                if (err) return res.status(500).json({ success: false, message: 'Error borrando archivo.' });
                res.status(200).json({ success: true, message: 'Eliminado.' });
            });
        } else {
            res.status(404).json({ success: false, message: 'Archivo no encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error inesperado.' });
    }
});

// --- API Admin (Módulo Administrador de TV) ---

app.get('/api/admin/tvs', async (req, res) => {
    try {
        const query = 'SELECT tv_uuid, name FROM nexus_tv.tv_screens';
        const result = await pool.query(query);
        const tvs = result.rows.map(tv => ({
            ...tv,
            online: connectedTVs.has(tv.tv_uuid)
        }));
        res.status(200).json({ success: true, tvs });
    } catch (err) {
        console.error('Error obteniendo TVs:', err);
        res.status(500).json({ success: false, message: 'Error de servidor' });
    }
});

app.get('/api/admin/temp-playlist/:tv_uuid', (req, res) => {
    const { tv_uuid } = req.params;
    if (!tv_uuid) return res.status(400).json({ success: false, message: 'Falta tv_uuid' });

    sqliteDb.all('SELECT * FROM temp_content WHERE tv_uuid = ? ORDER BY id ASC', [tv_uuid], (err, rows) => {
        if (err) {
            console.error('Error fetching SQLite:', err);
            return res.status(500).json({ success: false, message: 'Error BD' });
        }
        res.status(200).json({ success: true, playlist: rows });
    });
});

app.post('/api/admin/temp-playlist/add', (req, res) => {
    const { tv_uuid, content_url, duration } = req.body;
    if (!tv_uuid || !content_url) {
        return res.status(400).json({ success: false, message: 'Faltan datos requeridos (tv_uuid, content_url)' });
    }
    
    // Guardar en SQLite sin emitir play automático
    sqliteDb.run('INSERT INTO temp_content (tv_uuid, content_url, duration) VALUES (?, ?, ?)', [tv_uuid, content_url, duration || 30], function(err) {
        if (err) {
            console.error('Error insertando en SQLite:', err);
            return res.status(500).json({ success: false, message: 'Error guardando en BD temporal' });
        }
        res.status(200).json({ success: true, message: 'Video añadido a la playlist temporal.' });
    });
});

app.delete('/api/admin/temp-playlist/:id', (req, res) => {
    const { id } = req.params;
    sqliteDb.run('DELETE FROM temp_content WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('Error borrando en SQLite:', err);
            return res.status(500).json({ success: false, message: 'Error borrando de BD temporal' });
        }
        res.status(200).json({ success: true, message: 'Eliminado.' });
    });
});

app.put('/api/admin/temp-playlist/:id', (req, res) => {
    const { id } = req.params;
    const { duration } = req.body;
    
    sqliteDb.run('UPDATE temp_content SET duration = ? WHERE id = ?', [duration, id], function(err) {
        if (err) {
            console.error('Error actualizando SQLite:', err);
            return res.status(500).json({ success: false, message: 'Error actualizando BD' });
        }
        
        // Avisar a la TV para que recargue la lista temporal en memoria
        sqliteDb.get('SELECT tv_uuid FROM temp_content WHERE id = ?', [id], (err, row) => {
            if (row && row.tv_uuid) {
                io.to(row.tv_uuid).emit('TEMP_UPDATED');
            }
        });

        res.status(200).json({ success: true, message: 'Actualizado.' });
    });
});

app.post('/api/admin/temp-playlist/command', (req, res) => {
    const { tv_uuid, command, index } = req.body; 
    // command puede ser 'PLAY', 'PAUSE', 'STOP'
    // index indica desde qué video empezar (opcional)

    if (!tv_uuid || !command) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros' });
    }

    io.to(tv_uuid).emit('TEMP_CMD', {
        command: command, // 'PLAY', 'PAUSE', 'STOP'
        startIndex: index || 0
    });
    
    res.status(200).json({ success: true, message: `Comando ${command} enviado a la TV.` });
});

server.listen(port, () => {
    console.log(`✅ Servidor BUCLE + WebSocket listo en http://localhost:${port}`);
});

// === CRON JOB: Limpieza Diaria de SQLite Temporal ===
cron.schedule('59 23 * * *', () => {
    console.log('🧹 [CRON] Limpiando base de datos SQLite temporal de fin de día...');
    sqliteDb.run('DELETE FROM temp_content', (err) => {
        if (err) console.error('❌ Error limpiando SQLite:', err);
        else console.log('✅ SQLite Temporal limpiada correctamente.');
    });
});

// === CRON JOB: Limpieza Semanal de Archivos ===
// Ejecutar todos los domingos a las 3:00 AM ('0 3 * * 0')
cron.schedule('0 3 * * 0', async () => {
    console.log('🧹 [CRON] Iniciando limpieza semanal de archivos multimedia huérfanos...');
    try {
        // 1. Obtener todos los archivos en uso de la base de datos
        const query = "SELECT source_url FROM nexus_tv.content WHERE source_type = 'local_file'";
        const result = await pool.query(query);
        const inUseFiles = result.rows.map(row => path.basename(row.source_url));

        // 2. Leer todos los archivos físicos en la carpeta media
        fs.readdir(mediaDirectory, (err, files) => {
            if (err) {
                console.error('❌ [CRON] Error leyendo la carpeta media para limpieza:', err);
                return;
            }

            let deletedCount = 0;
            // 3. Comparar y eliminar los que no están en uso
            files.forEach(file => {
                if (!inUseFiles.includes(file)) {
                    const filePath = path.join(mediaDirectory, file);
                    fs.unlink(filePath, (unlinkErr) => {
                        if (unlinkErr) {
                            console.error(`❌ [CRON] Error eliminando archivo huérfano ${file}:`, unlinkErr);
                        } else {
                            deletedCount++;
                            console.log(`✅ [CRON] Archivo huérfano eliminado: ${file}`);
                        }
                    });
                }
            });
            setTimeout(() => {
                console.log(`🧹 [CRON] Limpieza completada. Archivos eliminados: ${deletedCount}`);
            }, 1000);
        });
    } catch (dbErr) {
        console.error('❌ [CRON] Error consultando base de datos durante limpieza:', dbErr);
    }
});