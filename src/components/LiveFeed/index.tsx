import React, { useEffect, useRef } from "react";
import { useMockContext, MockPlayer } from "../../mockContext";
import "./LiveFeed.scss";

const PlayerRow: React.FC<{ player: MockPlayer }> = ({ player }) => {
  const { phase } = useMockContext();
  const crashed = phase === "CRASHED";

  const lost = crashed && !player.cashedOut;

  return (
    <div
      className={[
        "lf-row",
        player.cashedOut ? "lf-row--cashout" : "",
        lost ? "lf-row--lost" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        className="lf-avatar"
        src={player.avatar}
        alt={player.name}
        loading="lazy"
      />
      <span className="lf-name">{player.name}</span>
      <span className="lf-bet">{player.betAmount.toFixed(2)}</span>
      <span className="lf-cashout">
        {player.cashedOut
          ? player.cashoutAt !== null
            ? `${player.cashoutAt.toFixed(2)}x`
            : "—"
          : "—"}
      </span>
      <span className="lf-payout">
        {player.cashedOut && player.cashoutAt !== null
          ? `+${(player.betAmount * player.cashoutAt).toFixed(2)}`
          : lost
          ? `−${player.betAmount.toFixed(2)}`
          : ""}
      </span>
    </div>
  );
};

const LiveFeed: React.FC = () => {
  const { mockPlayers } = useMockContext();
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new players arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [mockPlayers.length]);

  const cashedOut = mockPlayers.filter((p) => p.cashedOut).length;
  const total = mockPlayers.length;

  return (
    <div className="live-feed">
      <div className="lf-header">
        <span className="lf-title">Live Players</span>
        <span className="lf-counter">
          <span className="lf-counter__dot" />
          {total} players · {cashedOut} cashed out
        </span>
      </div>

      {/* Column headers */}
      <div className="lf-cols">
        <span className="lf-col lf-col--name">Player</span>
        <span className="lf-col lf-col--bet">Bet</span>
        <span className="lf-col lf-col--cashout">At</span>
        <span className="lf-col lf-col--payout">Win/Loss</span>
      </div>

      <div className="lf-list" ref={listRef}>
        {mockPlayers.length === 0 ? (
          <div className="lf-empty">Waiting for players…</div>
        ) : (
          mockPlayers.map((p) => <PlayerRow key={p.id} player={p} />)
        )}
      </div>
    </div>
  );
};

export default LiveFeed;
