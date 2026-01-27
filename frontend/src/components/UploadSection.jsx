
import React, { useState, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

const UploadSection = ({ onBatchStarted }) => {
    const [file, setFile] = useState(null);
    const [prompts, setPrompts] = useState({ prompt1: '', prompt2: '', prompt3: '' });
    const [loading, setLoading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);

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

    const handleInitiate = async () => {
        if (!file) return;

        setLoading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('prompt1', prompts.prompt1);
        formData.append('prompt2', prompts.prompt2);
        formData.append('prompt3', prompts.prompt3);

        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
            const res = await axios.post(`${backendUrl}/api/initiate-batch`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data.success) {
                onBatchStarted(res.data.batchId);
            }
        } catch (err) {
            console.error(err);
            alert('Initialization Failed: Connection lost or server error.');
        } finally {
            setLoading(false);
        }
    };

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
                            onClick={handleInitiate}
                            disabled={loading || !file}
                        >
                            {loading ? (
                                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                    INITIALIZING <span className="loader"></span>
                                </span>
                            ) : 'EXECUTE BATCH SEQUENCE'}
                        </button>
                    </motion.div>
                </div>

            </div>
        </motion.div>
    );
};

export default UploadSection;
