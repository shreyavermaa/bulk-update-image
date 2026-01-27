
import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import Papa from 'papaparse';

const UploadSection = ({ onBatchStarted }) => {
    // Mode: 'config' | 'processing' | 'done'
    const [mode, setMode] = useState('config');
    const [file, setFile] = useState(null);
    const [prompts, setPrompts] = useState({ prompt1: '', prompt2: '', prompt3: '' });
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);

    // Processing State
    const [batchId, setBatchId] = useState(null);
    const [csvData, setCsvData] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [stats, setStats] = useState({ success: 0, failed: 0, skipped: 0 });
    const [logs, setLogs] = useState([]);
    const [isPaused, setIsPaused] = useState(false);
    const [waitTimer, setWaitTimer] = useState(0);
    const [activeItem, setActiveItem] = useState(null); // { id: '...', variant: 1 }

    // Auto-scroll logs
    const logsEndRef = useRef(null);
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const addLog = (msg) => {
        setLogs(prev => [...prev.slice(-6), `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const waitWithCountdown = (seconds) => {
        return new Promise(resolve => {
            setWaitTimer(seconds);
            const interval = setInterval(() => {
                setWaitTimer(prev => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        resolve();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        });
    };

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile?.type === 'text/csv' || droppedFile?.name.endsWith('.csv')) {
            setFile(droppedFile);
        } else {
            alert('System Error: Incompatible file format. CSV required.');
        }
    };

    const startProcessing = async () => {
        if (!file) return;

        // 1. Parse CSV
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                if (results.data.length === 0) {
                    alert('CSV is empty');
                    return;
                }
                setCsvData(results.data);

                // 2. Get Batch ID
                try {
                    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
                    const res = await axios.get(`${backendUrl}/api/new-batch-id`);
                    const newBatchId = res.data.batchId;
                    setBatchId(newBatchId);
                    setMode('processing');
                    addLog(`Initialized Batch: ${newBatchId}`);
                    addLog(`Loaded ${results.data.length} items from CSV`);

                    // Start Loop
                    processLoop(results.data, newBatchId, 0);

                } catch (err) {
                    console.error(err);
                    alert('Failed to connect to backend');
                }
            },
            error: (err) => {
                alert('Failed to parse CSV: ' + err.message);
            }
        });
    };

    const processLoop = async (data, bId, index) => {
        if (index >= data.length) {
            setMode('done');
            setActiveItem(null);
            addLog('All items command completed.');
            if (onBatchStarted) onBatchStarted(bId);
            return;
        }

        if (isPaused) {
            addLog('Paused. Waiting to resume...');
            return;
        }

        const item = data[index];
        setCurrentIndex(index);
        // addLog(`Processing item ${index + 1}/${data.length}: ${item.Product_ID || 'Unknown Type'}`);

        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
            const n8nUrl = 'https://n8n.srv1163673.hstgr.cloud/webhook/image-variant'; // Hardcoded for now

            // Function to process a single prompt variant
            const processVariant = async (variantNum, promptText) => {
                if (!promptText) return; // Skip if empty

                const safeProductId = (item.Product_ID || item.product_id || item.id || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '');
                const uniqueName = `${safeProductId}-${variantNum}`;

                setActiveItem({ id: safeProductId, variant: variantNum, status: 'STARTING' });
                addLog(`[${safeProductId}] Starting Var ${variantNum}...`);

                // 1. Log START to Backend
                await axios.post(`${backendUrl}/api/db/start-item`, {
                    batchId: bId,
                    csvRowNumber: index + 1,
                    productData: item,
                    prompts: prompts,
                    uniqueName: uniqueName,
                    variantNum: variantNum
                });

                // 2. Call n8n Directly
                // Note: user requested "productData" sent? 
                // queue.js logic was: image, ProductName, prompt, timestamp
                const payload = {
                    image: item.Image_Link || item.image_link || '',
                    ProductName: uniqueName,
                    prompt: promptText,
                    timestamp: uniqueName
                };

                setActiveItem({ id: safeProductId, variant: variantNum, status: 'SENDING TO AI' });
                addLog(`[${safeProductId}] Sending to n8n...`);
                const n8nRes = await axios.post(n8nUrl, payload);

                if (n8nRes.data && n8nRes.data.success) {
                    // 3. Log COMPLETE to Backend
                    setActiveItem({ id: safeProductId, variant: variantNum, status: 'SAVING' });
                    await axios.post(`${backendUrl}/api/db/complete-item`, {
                        batchId: bId,
                        productId: safeProductId, // backend expects product_id used in DB
                        variantNum: variantNum
                    });
                    addLog(`[${safeProductId}] Var ${variantNum} COMPLETED.`);
                } else {
                    throw new Error(`n8n response not success: ${JSON.stringify(n8nRes.data)}`);
                }
            };

            // Run variants sequentially
            if (prompts.prompt1) await processVariant(1, prompts.prompt1);
            if (prompts.prompt2) await processVariant(2, prompts.prompt2);
            if (prompts.prompt3) await processVariant(3, prompts.prompt3);

            setStats(prev => ({ ...prev, success: prev.success + 1 }));
            setActiveItem(null);

            // Standard Delay 60s for EACH request as requested
            addLog(`Item Done. Cooling down for 60s...`);
            await waitWithCountdown(60);
            processLoop(data, bId, index + 1);

        } catch (err) {
            console.error(err);
            setStats(prev => ({ ...prev, failed: prev.failed + 1 }));

            const errMsg = err.response ? `API Error ${err.response.status}` : err.message;
            addLog(`Error: ${errMsg}. Waiting 60s to retry...`);
            setActiveItem({ id: 'ERROR', variant: '-', status: 'RETRYING' });

            // Error Delay (Smart Backoff)
            await waitWithCountdown(60);
            addLog(`Retrying item ${index + 1}...`);
            processLoop(data, bId, index);
        }
    };

    if (mode !== 'config') {
        // Processing Dashboard UI
        const percent = Math.round((currentIndex / csvData.length) * 100);

        return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel">
                <h2 style={{ color: '#fff', marginBottom: '1rem' }}>
                    <span style={{ color: 'var(--primary)' }}>//</span> BATCH EXECUTION: {batchId}
                </h2>

                {/* Progress Bar */}
                <div style={{ background: '#333', height: '10px', borderRadius: '5px', overflow: 'hidden', marginBottom: '1rem' }}>
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percent}%` }}
                        style={{ height: '100%', background: 'var(--primary)' }}
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', fontSize: '0.9rem', marginBottom: '2rem' }}>
                    <span>Progress: {percent}% ({currentIndex}/{csvData.length})</span>
                    <span>Status: {mode === 'done' ? 'COMPLETED' : 'ACTIVE'}</span>
                </div>

                {/* Active Item Display */}
                {activeItem && (
                    <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '8px' }}>
                        <div style={{ color: '#38bdf8', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>CURRENTLY PROCESSING</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ fontSize: '1.2rem', color: '#fff' }}>Best-ID: {activeItem.id}</div>
                            <div style={{ padding: '0.2rem 0.6rem', background: '#38bdf8', color: '#000', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                VARIATION {activeItem.variant}
                            </div>
                            <div style={{ marginLeft: 'auto', color: '#ccc' }}>{activeItem.status}...</div>
                        </div>
                    </div>
                )}

                {/* Wait Timer Display */}
                {waitTimer > 0 && (
                    <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px dashed rgba(255, 255, 255, 0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ color: '#aaa', marginRight: '1rem' }}>COOLDOWN / RATE LIMIT PAUSE:</span>
                        <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#fff' }}>{waitTimer}s</span>
                    </div>
                )}

                {/* Stats Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                    <div style={{ background: 'rgba(0,255,0,0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(0,255,0,0.3)' }}>
                        <div style={{ fontSize: '2rem', color: '#4ade80' }}>{stats.success}</div>
                        <div style={{ fontSize: '0.8rem', color: '#aaa' }}>SUCCESS</div>
                    </div>
                    <div style={{ background: 'rgba(255,0,0,0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,0,0,0.3)' }}>
                        <div style={{ fontSize: '2rem', color: '#f87171' }}>{stats.failed}</div>
                        <div style={{ fontSize: '0.8rem', color: '#aaa' }}>RETRIES</div>
                    </div>
                </div>

                {/* Logs Terminal */}
                <div style={{ background: '#000', padding: '1rem', borderRadius: '8px', fontFamily: 'monospace', height: '150px', overflowY: 'auto', border: '1px solid #333' }}>
                    {logs.map((log, i) => (
                        <div key={i} style={{ color: log.includes('Error') ? '#f87171' : '#ccc', marginBottom: '4px', fontSize: '0.85rem' }}>
                            {log}
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>

                {mode === 'done' && (
                    <button
                        className="cyber-btn"
                        style={{ marginTop: '2rem', width: '100%' }}
                        onClick={() => { setMode('config'); setFile(null); setLogs([]); setStats({ success: 0, failed: 0, skipped: 0 }); setCurrentIndex(0); }}
                    >
                        START NEW BATCH
                    </button>
                )}
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="glass-panel"
        >
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.5fr) 1fr', gap: '4rem' }}>

                {/* Left: Prompts Configuration */}
                <div>
                    <h2 style={{ marginBottom: '2rem', color: '#fff', fontSize: '1.8rem' }}>
                        <span style={{ color: 'var(--primary)' }}>//</span> OPERATION CONFIG
                    </h2>

                    <AnimatePresence>
                        {['prompt1', 'prompt2', 'prompt3'].map((key, i) => (
                            <motion.div
                                key={key}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="modern-input-group"
                            >
                                <label className="modern-label">Variation Sequence 0{i + 1}</label>
                                <textarea
                                    className="modern-textarea"
                                    placeholder={`Enter generate directive ${i + 1}...`}
                                    value={prompts[key]}
                                    onChange={e => setPrompts({ ...prompts, [key]: e.target.value })}
                                    spellCheck="false"
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {/* Right: Data Ingestion */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h2 style={{ marginBottom: '2rem', color: '#fff', fontSize: '1.8rem' }}>
                        <span style={{ color: 'var(--secondary)' }}>//</span> DATA INGESTION
                    </h2>

                    <div
                        className={`dropzone ${dragActive ? 'active' : ''}`}
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current.click()}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            hidden
                            accept=".csv"
                            onChange={e => setFile(e.target.files[0])}
                        />

                        <motion.div
                            animate={{ y: file ? 0 : [0, -10, 0] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        >
                            <div className="drop-icon">{file ? '💾' : '📥'}</div>
                        </motion.div>

                        {file ? (
                            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                                <strong style={{ color: 'var(--primary)', fontSize: '1.4rem', display: 'block', marginBottom: '0.5rem' }}>
                                    {file.name}
                                </strong>
                                <div style={{ color: 'var(--text-muted)' }}>
                                    READY FOR PARSING • {(file.size / 1024).toFixed(1)} KB
                                </div>
                            </motion.div>
                        ) : (
                            <div>
                                <p style={{ fontSize: '1.2rem', fontWeight: '500' }}>Drop Target Active</p>
                                <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Upload CSV Manifest</p>
                            </div>
                        )}
                    </div>

                    <motion.div style={{ marginTop: '2rem' }}>
                        <button
                            className="cyber-btn"
                            onClick={startProcessing}
                            disabled={!file}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                EXECUTE BROWSER AGENT
                            </span>
                        </button>
                    </motion.div>
                </div>

            </div>
        </motion.div>
    );
};

export default UploadSection;
