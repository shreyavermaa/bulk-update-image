import React, { useState } from 'react';
import './App.css';
import UploadSection from './components/UploadSection';
import StatusDashboard from './components/StatusDashboard';
import BatchHistory from './components/BatchHistory';
import { motion } from 'framer-motion';

function App() {
  const [batchId, setBatchId] = useState(null);
  const [view, setView] = useState('upload'); // 'upload', 'dashboard', 'history'

  const handleBatchStarted = (id) => {
    setBatchId(id);
    setView('dashboard');
  };

  const handleViewBatch = (id) => {
    setBatchId(id);
    setView('dashboard');
  };

  return (
    <div className="container">
      <div className="hero-section">
        <motion.h1
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, type: 'spring' }}
          className="hero-title"
        >
          NEXUS GEN
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 1 }}
          className="hero-subtitle"
        >
          Automated Multi-Vector Image Synthesis Platform v2.0
        </motion.p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '3rem' }}>
        <button
          onClick={() => setView('upload')}
          style={{
            background: 'transparent',
            border: 'none',
            color: view === 'upload' ? 'var(--primary)' : '#666',
            fontSize: '1.2rem',
            cursor: 'pointer',
            fontWeight: view === 'upload' ? 'bold' : 'normal',
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}
        >
          New Batch
        </button>

        {batchId && (
          <button
            onClick={() => setView('dashboard')}
            style={{
              background: 'transparent',
              border: 'none',
              color: view === 'dashboard' ? 'var(--primary)' : '#666',
              fontSize: '1.2rem',
              cursor: 'pointer',
              fontWeight: view === 'dashboard' ? 'bold' : 'normal',
              textTransform: 'uppercase',
              letterSpacing: '0.1em'
            }}
          >
            Dashboard
          </button>
        )}

        <button
          onClick={() => setView('history')}
          style={{
            background: 'transparent',
            border: 'none',
            color: view === 'history' ? 'var(--primary)' : '#666',
            fontSize: '1.2rem',
            cursor: 'pointer',
            fontWeight: view === 'history' ? 'bold' : 'normal',
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}
        >
          History
        </button>
      </div>

      <div className="content-area">
        {view === 'upload' && (
          <UploadSection onBatchStarted={handleBatchStarted} />
        )}

        {view === 'dashboard' && batchId && (
          <StatusDashboard batchId={batchId} />
        )}

        {view === 'history' && (
          <BatchHistory onViewBatch={handleViewBatch} />
        )}
      </div>

      <div style={{
        textAlign: 'center',
        marginTop: '6rem',
        color: 'rgba(255,255,255,0.2)',
        fontSize: '0.7rem',
        fontFamily: 'monospace',
        letterSpacing: '0.2em'
      }}>
        SECURE CONNECTION ESTABLISHED • SYSTEM ONLINE
      </div>
    </div>
  );
}

export default App;
