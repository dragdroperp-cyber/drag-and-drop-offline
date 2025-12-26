// Temporary debug component to check plan details
import React from 'react';
import { useApp } from '../../context/AppContext';

const PlanDebugPanel = () => {
    const { state } = useApp();

    return (
        <div style={{
            position: 'fixed',
            top: '10px',
            right: '10px',
            background: '#1e293b',
            color: 'white',
            padding: '20px',
            borderRadius: '10px',
            maxWidth: '400px',
            maxHeight: '80vh',
            overflow: 'auto',
            zIndex: 9999,
            fontSize: '12px',
            fontFamily: 'monospace'
        }}>
            <h3 style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
                🐛 Plan Details Debug
            </h3>

            <div style={{ marginBottom: '10px' }}>
                <strong>currentPlanDetails:</strong>
                <pre style={{
                    background: '#0f172a',
                    padding: '10px',
                    borderRadius: '5px',
                    marginTop: '5px',
                    overflow: 'auto',
                    maxHeight: '200px'
                }}>
                    {JSON.stringify(state.currentPlanDetails, null, 2)}
                </pre>
            </div>

            <div style={{ marginBottom: '10px' }}>
                <strong>Is null?</strong> {state.currentPlanDetails === null ? '❌ YES' : '✅ NO'}
            </div>

            <div style={{ marginBottom: '10px' }}>
                <strong>Has unlockedModules?</strong> {state.currentPlanDetails?.unlockedModules ? '✅ YES' : '❌ NO'}
            </div>

            <div style={{ marginBottom: '10px' }}>
                <strong>Is Array?</strong> {Array.isArray(state.currentPlanDetails?.unlockedModules) ? '✅ YES' : '❌ NO'}
            </div>

            <div style={{ marginBottom: '10px' }}>
                <strong>Unlocked Modules:</strong>
                <pre style={{
                    background: '#0f172a',
                    padding: '10px',
                    borderRadius: '5px',
                    marginTop: '5px',
                    overflow: 'auto',
                    maxHeight: '150px'
                }}>
                    {JSON.stringify(state.currentPlanDetails?.unlockedModules, null, 2)}
                </pre>
            </div>

            <div style={{ marginBottom: '10px' }}>
                <strong>Current Plan:</strong> {state.currentPlan || 'N/A'}
            </div>
        </div>
    );
};

export default PlanDebugPanel;
