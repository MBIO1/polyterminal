import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import './index.css';

// Simple pages
const Dashboard = () => (
  <div className="p-6">
    <h1 className="text-3xl font-bold mb-4">MBIO Arbitrage Dashboard</h1>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="p-4 bg-blue-100 rounded">
        <h3 className="font-bold">Total P&L</h3>
        <p className="text-2xl">$0.00</p>
      </div>
      <div className="p-4 bg-green-100 rounded">
        <h3 className="font-bold">Active Trades</h3>
        <p className="text-2xl">0</p>
      </div>
      <div className="p-4 bg-yellow-100 rounded">
        <h3 className="font-bold">Signals Today</h3>
        <p className="text-2xl">0</p>
      </div>
    </div>
    <div className="mt-6 p-4 bg-gray-100 rounded">
      <p>Dashboard is loading... Connect to Base44 backend for live data.</p>
    </div>
  </div>
);

const Trades = () => <div className="p-6"><h1>Trades</h1><p>No trades yet.</p></div>;
const Signals = () => <div className="p-6"><h1>Signals</h1><p>No signals yet.</p></div>;
const Health = () => <div className="p-6"><h1>Droplet Health</h1><p>Check droplet status here.</p></div>;

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-blue-600 text-white p-4">
          <div className="flex gap-4">
            <Link to="/" className="hover:underline">Dashboard</Link>
            <Link to="/trades" className="hover:underline">Trades</Link>
            <Link to="/signals" className="hover:underline">Signals</Link>
            <Link to="/health" className="hover:underline">Health</Link>
          </div>
        </nav>
        
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/health" element={<Health />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
