import React, { useState } from "react";
import { useMockContext } from "../../mockContext";
import "./ControlCenter.scss";

type SlotKey = "f" | "s";

interface BetPanelProps {
  slot: SlotKey;
  label: string;
}

const BetPanel: React.FC<BetPanelProps> = ({ slot, label }) => {
  const {
    phase,
    multiplier,
    balance,
    betSlotF,
    betSlotS,
    placeBet,
    cancelBet,
    cashOut,
    updateBetSlot,
  } = useMockContext();

  const betData = slot === "f" ? betSlotF : betSlotS;
  const { betAmount, autoCashoutAt, betted, cashedOut, cashoutMultiplier } = betData;

  const [localAmount, setLocalAmount] = useState(betAmount);
  const [localAutoCashout, setLocalAutoCashout] = useState(autoCashoutAt);
  const [autoCashoutEnabled, setAutoCashoutEnabled] = useState(false);

  const isWaiting    = phase === "WAITING_FOR_BETS";
  const isFlying     = phase === "FLYING";
  const isCrashed    = phase === "CRASHED";
  const canBet       = isWaiting && !betted;
  const canCashOut   = isFlying && betted && !cashedOut;
  const canCancel    = isWaiting && betted;
  const isPending    = !isWaiting && betted && !cashedOut && !isCrashed;

  const commitAmount = (v: number) => {
    const clamped = Math.max(1, Math.min(v, balance, 10_000));
    setLocalAmount(clamped);
    updateBetSlot(slot, { betAmount: clamped });
  };

  const commitAutoCashout = (v: number) => {
    const clamped = Math.max(1.01, v);
    setLocalAutoCashout(clamped);
    updateBetSlot(slot, { autoCashoutAt: autoCashoutEnabled ? clamped : 0 });
  };

  const toggleAutoCashout = () => {
    const next = !autoCashoutEnabled;
    setAutoCashoutEnabled(next);
    updateBetSlot(slot, { autoCashoutAt: next ? localAutoCashout : 0 });
  };

  const quickAmounts = [10, 50, 100, 500];

  const displayMultiplier = isFlying
    ? multiplier
    : (autoCashoutEnabled && autoCashoutAt > 1 ? autoCashoutAt : 2);
  const potentialWin = (betAmount * displayMultiplier).toFixed(2);

  return (
    <div className={`cc-panel ${betted && !cashedOut ? "cc-panel--active" : ""} ${cashedOut ? "cc-panel--cashout" : ""} ${isCrashed && betted && !cashedOut ? "cc-panel--lost" : ""}`}>
      <div className="cc-panel__header">{label}</div>

      {/* Bet Amount */}
      <div className="cc-field">
        <label className="cc-field__label">Bet Amount</label>
        <div className="cc-spinner">
          <button
            className="cc-spinner__btn"
            disabled={!canBet}
            onClick={() => commitAmount(localAmount - 1)}
          >−</button>
          <input
            type="number"
            className="cc-spinner__input"
            value={localAmount}
            readOnly={!canBet}
            onChange={(e) => setLocalAmount(Number(e.target.value))}
            onBlur={(e) => commitAmount(Number(e.target.value))}
            min={1}
          />
          <button
            className="cc-spinner__btn"
            disabled={!canBet}
            onClick={() => commitAmount(localAmount + 1)}
          >+</button>
        </div>
        <div className="cc-quick-bets">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              className="cc-quick-bet"
              disabled={!canBet}
              onClick={() => commitAmount(amt)}
            >{amt}</button>
          ))}
        </div>
      </div>

      {/* Auto Cash-Out */}
      <div className="cc-field">
        <div className="cc-field__row">
          <label className="cc-field__label">Auto Cash-Out</label>
          <button
            className={`cc-toggle ${autoCashoutEnabled ? "cc-toggle--on" : ""}`}
            onClick={toggleAutoCashout}
            disabled={betted}
          >
            <span className="cc-toggle__knob" />
          </button>
        </div>
        {autoCashoutEnabled && (
          <div className="cc-spinner cc-spinner--slim">
            <button
              className="cc-spinner__btn"
              disabled={betted}
              onClick={() => commitAutoCashout(localAutoCashout - 0.1)}
            >−</button>
            <input
              type="number"
              className="cc-spinner__input"
              value={localAutoCashout.toFixed(2)}
              readOnly={betted}
              step={0.1}
              onChange={(e) => setLocalAutoCashout(Number(e.target.value))}
              onBlur={(e) => commitAutoCashout(Number(e.target.value))}
            />
            <span className="cc-spinner__suffix">x</span>
            <button
              className="cc-spinner__btn"
              disabled={betted}
              onClick={() => commitAutoCashout(localAutoCashout + 0.1)}
            >+</button>
          </div>
        )}
      </div>

      {/* Action button */}
      <div className="cc-action">
        {cashedOut && (
          <div className="cc-result cc-result--win">
            ✓ Cashed out @ {cashoutMultiplier.toFixed(2)}x
            <span className="cc-result__amount">+{(betAmount * cashoutMultiplier).toFixed(2)}</span>
          </div>
        )}

        {isCrashed && betted && !cashedOut && (
          <div className="cc-result cc-result--loss">
            ✗ Flew away − lost {betAmount.toFixed(2)}
          </div>
        )}

        {canBet && (
          <button className="cc-btn cc-btn--bet" onClick={() => placeBet(slot)}>
            <span className="cc-btn__label">BET</span>
            <span className="cc-btn__amount">{betAmount.toFixed(2)} INR</span>
          </button>
        )}

        {canCancel && (
          <button className="cc-btn cc-btn--cancel" onClick={() => cancelBet(slot)}>
            CANCEL BET
          </button>
        )}

        {canCashOut && (
          <button className="cc-btn cc-btn--cashout" onClick={() => cashOut(slot)}>
            <span className="cc-btn__label">CASH OUT</span>
            <span className="cc-btn__amount">
              {(betAmount * multiplier).toFixed(2)} INR
            </span>
          </button>
        )}

        {isPending && !canCashOut && !canCancel && (
          <button className="cc-btn cc-btn--waiting" disabled>
            WAITING…
          </button>
        )}

        {/* Show potential win when not in an active state */}
        {canBet && (
          <div className="cc-potential">
            Potential win at {autoCashoutEnabled ? `${autoCashoutAt.toFixed(2)}x` : "2.00x"}: &nbsp;
            <strong>{potentialWin} INR</strong>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Control Center ───────────────────────────────────────────────────────────
const ControlCenter: React.FC = () => {
  const [showSecond, setShowSecond] = useState(false);
  const { balance } = useMockContext();

  return (
    <div className="control-center">
      <div className="cc-balance">
        <span className="cc-balance__label">Balance</span>
        <span className="cc-balance__value">{balance.toFixed(2)} INR</span>
      </div>

      <div className="cc-panels">
        <BetPanel slot="f" label="Bet 1" />
        {showSecond
          ? <BetPanel slot="s" label="Bet 2" />
          : null
        }
      </div>

      <button
        className={`cc-add-bet ${showSecond ? "cc-add-bet--remove" : ""}`}
        onClick={() => setShowSecond((v) => !v)}
      >
        {showSecond ? "− Remove Bet 2" : "+ Add Bet 2"}
      </button>
    </div>
  );
};

export default ControlCenter;
