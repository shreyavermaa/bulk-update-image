import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

const StatusDashboard = ({ batchId }) => {
    const [items, setItems] = useState([]);

    useEffect(() => {
        if (!batchId) return;

        const fetchStatus = async () => {
            try {
                const res = await axios.get(`http://localhost:5000/api/batch-status/${batchId}`);
                setItems(res.data);
            } catch (err) {
                console.error('Polling error', err);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 3000); // Poll every 3 seconds

        return () => clearInterval(interval);
    }, [batchId]);

    if (!batchId) return null;

    return (
        <div style={{ width: '100%' }}>
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="dashboard-header"
            >
                <div>
                    <h2 style={{ fontSize: '2rem' }}>LIVE OPERATIONS</h2>
                    <div style={{ color: 'var(--primary)', fontFamily: 'monospace', marginTop: '0.5rem' }}>
                        &gt; BATCH_ID:: {batchId}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ color: 'var(--text-muted)' }}>ITEMS PROCESSED</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                        {items.filter(i => i.status1 === 'COMPLETED' || i.status2 === 'COMPLETED' || i.status3 === 'COMPLETED').length}
                        <span style={{ color: '#555' }}> / </span>
                        {items.length * 3}
                    </div>
                </div>
            </motion.div>

            <div className="status-grid">
                <AnimatePresence>
                    {items.map((item, index) => (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.05 }}
                            className="status-card"
                        >
                            <div className="product-preview">
                                <img
                                    src={item.image_link}
                                    alt="Product"
                                    className="product-thumb"
                                    onError={(e) => { e.target.style.display = 'none' }}
                                />
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{item.product_id}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                        ID: {item.id.slice(0, 8)}
                                    </div>
                                </div>
                            </div>

                            <div className="variant-list">
                                {[1, 2, 3].map(v => (
                                    <VariantStatus
                                        key={v}
                                        num={v}
                                        status={item[`status${v}`]}
                                        imagePath={item[`image${v}_path`]}
                                    />
                                ))}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

const VariantStatus = ({ num, status, imagePath }) => {
    const s = status ? status.toLowerCase() : 'pending';

    let color = '#555';
    let icon = '•';

    if (s === 'processing') { color = 'var(--primary)'; icon = '⚡'; }
    if (s === 'completed') { color = '#00ff9d'; icon = '✓'; }
    if (s === 'failed') { color = 'var(--secondary)'; icon = '✕'; }
    if (s === 'skipped') { color = '#333'; icon = '-'; }

    const imageUrl = imagePath
        ? `https://rlptkbneebkgfiutcbmt.supabase.co/storage/v1/object/public/ai-image/${imagePath}`
        : null;

    return (
        <div className="variant-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>VAR 0{num}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`status-text ${s}`} style={{ fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>
                        {status || 'PENDING'}
                    </span>
                    <span style={{ color }}>{icon}</span>
                </div>
            </div>

            {s === 'completed' && imageUrl && (
                <div style={{ marginTop: '5px', width: '100%', borderRadius: '4px', overflow: 'hidden', border: '1px solid #333' }}>
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                        <img
                            src={imageUrl}
                            alt={`Variant ${num}`}
                            style={{ width: '100%', height: 'auto', display: 'block' }}
                        />
                    </a>
                </div>
            )}
        </div>
    );
};

export default StatusDashboard;
