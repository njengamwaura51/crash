import React from "react";
import Header from "./components/header";
import BetsUsers from "./components/bet-users";
import Main from "./components/Main";
// import { useCrashContext } from "./components/Main/context";
import propeller from "./assets/images/propeller.png";

import Context from "./context";
// import "./App.scss";

function App() {
  const { unityLoading, currentProgress, rechargeState, errorBackend } =
    React.useContext(Context);
  return (
    <div className="main-container">
      {errorBackend && (
        <div style={{
          position: 'fixed',
          top: '10px',
          right: '10px',
          background: '#ff4444',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '4px',
          zIndex: 9999,
          fontSize: '12px'
        }}>
          ⚠️ Connection to server lost
        </div>
      )}
     
      {!unityLoading && (
        <div className="myloading">
          <div className="loading-container">
            <div className="rotation">
              <img alt="propeller" src={propeller}></img>
            </div>
            <div className="waiting">
              <div
                style={{ width: `${currentProgress * 1.111 + 0.01}%` }}
              ></div>
            </div>
            <p>{Number(currentProgress * 1.111 + 0.01).toFixed(2)}%</p>
          </div>
        </div>
      )}
      {rechargeState && (
        <div className="recharge">
          <div className="recharge-body">
            <div className="recharge-body-font">
              Insufficient balance amount
            </div>
            <a href="https://induswin.com/#/pages/recharge/recharge">
              Induswin.com
            </a>
          </div>
        </div>
      )}
      <Header />
      <div className="game-container">
        <BetsUsers />
        <Main />
      </div>
    </div>
  );
}

export default App;
