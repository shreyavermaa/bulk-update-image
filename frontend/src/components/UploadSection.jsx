
import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import Papa from 'papaparse';

// Constants — read once, not on every loop iteration
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const N8N_URL = 'https://n8n.srv1163673.hstgr.cloud/webhook/image-variant';
const MAX_RETRIES_PER_ITEM = 3;

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

                // Sanitize CSV data: trim whitespace from Product_ID and Image_Link
                const sanitizedData = results.data.map(row => ({
                    ...row,
                    Product_ID: (row.Product_ID || row.product_id || '').trim(),
                    product_id: (row.Product_ID || row.product_id || '').trim(),
                    Image_Link: (row.Image_Link || row.image_link || '').trim(),
                    image_link: (row.Image_Link || row.image_link || '').trim()
                }));

                setCsvData(sanitizedData);

                // 2. Get Batch ID
                try {
                    const res = await axios.get(`${BACKEND_URL}/api/new-batch-id`);
                    const newBatchId = res.data.batchId;
                    setBatchId(newBatchId);
                    setMode('processing');
                    addLog(`Initialized Batch: ${newBatchId}`);
                    addLog(`Loaded ${sanitizedData.length} items from CSV`);

                    // Start Loop
                    processLoop(sanitizedData, newBatchId, 0);

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

    const processLoop = async (data, bId, index, retryCount = 0) => {
        if (index >= data.length) {
            setMode('done');
            setActiveItem(null);
            addLog('All items completed.');
            if (onBatchStarted) onBatchStarted(bId);
            return;
        }

        const item = data[index];
        setCurrentIndex(index);

        try {

            // Function to process a single prompt variant
            const processVariant = async (variantNum, promptText) => {
                if (!promptText) return; // Skip if empty

                const safeProductId = (item.Product_ID || item.product_id || item.id || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '');
                const uniqueName = `${safeProductId}-${variantNum}`;

                setActiveItem({ id: safeProductId, variant: variantNum, status: 'STARTING' });
                addLog(`[${safeProductId}] Starting Var ${variantNum}...`);

                // 1. Log START to Backend
                await axios.post(`${BACKEND_URL}/api/db/start-item`, {
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
                const n8nRes = await axios.post(N8N_URL, payload);

                // Log response for debugging
                addLog(`[${safeProductId}] n8n status: ${n8nRes.status}, data: ${JSON.stringify(n8nRes.data || {}).slice(0, 100)}`);

                // Accept any 2xx status code as success (standard HTTP practice)
                if (n8nRes.status >= 200 && n8nRes.status < 300) {
                    // 3. Log COMPLETE to Backend with retry logic
                    setActiveItem({ id: safeProductId, variant: variantNum, status: 'SAVING' });

                    // CRITICAL FIX: Retry complete-item up to 3 times with exponential backoff
                    // This prevents items from getting stuck in PROCESSING if backend is temporarily down
                    let completeSaved = false;
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            await axios.post(`${BACKEND_URL}/api/db/complete-item`, {
                                batchId: bId,
                                productId: safeProductId,
                                variantNum: variantNum
                            });
                            completeSaved = true;
                            addLog(`[${safeProductId}] Var ${variantNum} COMPLETED.`);
                            break; // Success - exit retry loop
                        } catch (completeErr) {
                            addLog(`[${safeProductId}] complete-item attempt ${attempt}/3 failed: ${completeErr.message}`);

                            if (attempt === 3) {
                                // After 3 failed attempts, mark as FAILED instead of leaving as PROCESSING
                                try {
                                    await axios.post(`${BACKEND_URL}/api/db/fail-item`, {
                                        batchId: bId,
                                        productId: safeProductId,
                                        variantNum: variantNum,
                                        errorMessage: `complete-item failed after 3 attempts: ${completeErr.message}`
                                    });
                                    addLog(`[${safeProductId}] Var ${variantNum} marked as FAILED (complete-item unreachable).`);
                                } catch (failErr) {
                                    addLog(`[${safeProductId}] ERROR: Could not mark as FAILED either: ${failErr.message}`);
                                }
                            } else {
                                // Exponential backoff: 1s, 2s
                                await new Promise(r => setTimeout(r, 1000 * attempt));
                            }
                        }
                    }

                    if (!completeSaved) {
                        throw new Error('Failed to save completion status after 3 attempts');
                    }
                } else {
                    throw new Error(`n8n returned status ${n8nRes.status}`);
                }
            };

            // Run variants sequentially with 60s delay between each
            if (prompts.prompt1) {
                await processVariant(1, prompts.prompt1);
                addLog(`Var 1 Done. Cooling down for 60s...`);
                await waitWithCountdown(60);
            }
            if (prompts.prompt2) {
                await processVariant(2, prompts.prompt2);
                addLog(`Var 2 Done. Cooling down for 60s...`);
                await waitWithCountdown(60);
            }
            if (prompts.prompt3) {
                await processVariant(3, prompts.prompt3);
                addLog(`Var 3 Done. Cooling down for 60s...`);
                await waitWithCountdown(60);
            }

            setStats(prev => ({ ...prev, success: prev.success + 1 }));
            setActiveItem(null);

            // Move to next item (no extra delay needed, already waited after each variant)
            addLog(`Item ${index + 1} complete. Moving to next...`);
            processLoop(data, bId, index + 1);

        } catch (err) {
            console.error(err);
            const errMsg = err.response ? `API Error ${err.response.status}` : err.message;

            if (retryCount < MAX_RETRIES_PER_ITEM - 1) {
                // Retry with backoff
                setStats(prev => ({ ...prev, failed: prev.failed + 1 }));
                addLog(`Error: ${errMsg}. Retry ${retryCount + 1}/${MAX_RETRIES_PER_ITEM}. Waiting 60s...`);
                setActiveItem({ id: 'ERROR', variant: '-', status: `RETRY ${retryCount + 1}/${MAX_RETRIES_PER_ITEM}` });
                await waitWithCountdown(60);
                processLoop(data, bId, index, retryCount + 1);
            } else {
                // Max retries reached — mark as FAILED and skip to next item
                addLog(`SKIPPING item ${index + 1} after ${MAX_RETRIES_PER_ITEM} failed attempts: ${errMsg}`);
                setStats(prev => ({ ...prev, failed: prev.failed + 1 }));

                // Try to mark all variants as FAILED in DB
                const safeProductId = (item.Product_ID || item.product_id || item.id || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '');
                try {
                    for (let v = 1; v <= 3; v++) {
                        await axios.post(`${BACKEND_URL}/api/db/fail-item`, {
                            batchId: bId,
                            productId: safeProductId,
                            variantNum: v,
                            errorMessage: `Skipped after ${MAX_RETRIES_PER_ITEM} retries: ${errMsg}`
                        }).catch(() => { }); // Best effort
                    }
                } catch (e) { /* best effort */ }

                setActiveItem(null);
                await waitWithCountdown(10); // Short pause before next item
                processLoop(data, bId, index + 1, 0); // Next item, reset retry counter
            }
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
