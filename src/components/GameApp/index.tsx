import React from "react";
import FlightArena from "../FlightArena";
import ControlCenter from "../ControlCenter";
import LiveFeed from "../LiveFeed";
import logoImg from "../../assets/images/logo.png";
import "./GameApp.scss";

/**
 * GameApp – the three-panel layout for the frontend-only crash game.
 *
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  Header (logo + phase indicator)                            │
 *  ├───────────────────────────────┬──────────────────────────────┤
 *  │                               │                              │
 *  │  Flight Arena (canvas)        │  Live Feed (players)         │
 *  │                               │                              │
 *  ├───────────────────────────────┴──────────────────────────────┤
 *  │  Control Center (betting panel)                              │
 *  └──────────────────────────────────────────────────────────────┘
 */

const GameApp: React.FC = () => {
  return (
    <div className="game-app">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="ga-header">
        <div className="ga-header__logo">
          <img
            src={logoImg}
            alt="Crash"
            className="ga-header__logo-img"
          />
          <span className="ga-header__title">CRASH</span>
        </div>
        <div className="ga-header__badge">
          <span className="ga-header__dot" />
          LIVE
        </div>
      </header>

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      <div className="ga-grid">
        {/* Flight Arena */}
        <section className="ga-arena">
          <FlightArena />
        </section>

        {/* Live Feed */}
        <aside className="ga-feed">
          <LiveFeed />
        </aside>
      </div>

      {/* ── Control Center ──────────────────────────────────────────────────── */}
      <section className="ga-controls">
        <ControlCenter />
      </section>
    </div>
  );
};

export default GameApp;
