import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const BatchHistory = ({ onViewBatch }) => {
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchBatches();
    }, []);

    const fetchBatches = async () => {
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
            const response = await fetch(`${backendUrl}/api/batches`);
            if (!response.ok) {
                throw new Error('Failed to fetch batches');
            }
            const data = await response.json();
            setBatches(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (batchId) => {
        try {
            // Trigger download
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
            window.location.href = `${backendUrl}/api/download-batch/${batchId}`;
        } catch (err) {
            console.error("Download failed", err);
            alert("Failed to download CSV");
        }
    };

    const handleDownloadZip = async (batchId) => {
        try {
            // Trigger download
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
            window.location.href = `${backendUrl}/api/download-images/${batchId}`;
        } catch (err) {
            console.error("Download failed", err);
            alert("Failed to download ZIP");
        }
    };

    if (loading) return <div className="text-center p-4">Loading history...</div>;
    if (error) return <div className="text-center p-4 text-red-500">Error: {error}</div>;

    return (
        <div className="glass-panel" style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <h2 style={{ marginBottom: '2rem', fontSize: '2rem', textAlign: 'center' }}>Batch History</h2>

            {batches.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#888' }}>No batches found.</p>
            ) : (
                <div className="history-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {batches.map((batch) => (
                        <motion.div
                            key={batch.batch_id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="history-item"
                            style={{
                                background: 'rgba(255,255,255,0.05)',
                                padding: '1.5rem',
                                borderRadius: '12px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                border: '1px solid rgba(255,255,255,0.1)'
                            }}
                        >
                            <div>
                                <h3 style={{ margin: '0 0 0.5rem 0', color: '#fff' }}>{batch.batch_id}</h3>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: '#aaa' }}>
                                    {batch.csv_name || 'Unknown File'} • {new Date(batch.created_at).toLocaleString()}
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button
                                    onClick={() => handleDownload(batch.batch_id)}
                                    className="cyber-btn"
                                    style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', width: 'auto' }}
                                >
                                    Download CSV
                                </button>
                                <button
                                    onClick={() => handleDownloadZip(batch.batch_id)}
                                    className="cyber-btn"
                                    style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', width: 'auto', background: 'rgba(0, 255, 157, 0.1)', color: '#00ff9d', borderColor: '#00ff9d' }}
                                >
                                    Download ZIP
                                </button>
                                <button
                                    onClick={() => onViewBatch(batch.batch_id)}
                                    className="cyber-btn"
                                    style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', width: 'auto', background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)' }}
                                >
                                    View
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default BatchHistory;
