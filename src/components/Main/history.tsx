import React from "react";
import Context from "../../context";

export default function History() {
  const { history } = React.useContext(Context);
  const [showHistory, setShowHistory] = React.useState(false);
  const historyItemsContainerRef = React.useRef<HTMLDivElement>(null);

  const reversedHistory = React.useMemo(() => history.slice().reverse(), [history]);

  React.useEffect(() => {
    if (historyItemsContainerRef.current && history.length > 0) {
      const container = historyItemsContainerRef.current;
      const items = container.children;
      let totalWidth = 0;
      for (let i = 0; i < items.length; i++) {
        totalWidth += (items[i] as HTMLElement).offsetWidth + 30;
      }
      const maxWidth = container.parentElement?.offsetWidth || 0;
      if (totalWidth > maxWidth - 40) {
        const shift = totalWidth - maxWidth + 40;
        container.style.transform = `translateX(-${shift}px)`;
      }
    }
  }, [history]);

  return (
    <>
      <div className="history-bar">
        <div className="history-content">
          <div className="history-items-container" ref={historyItemsContainerRef}>
            {reversedHistory.map((item, key) => {
              const num = parseFloat(item);
              const color = num < 2 ? '#00ffff' : num <= 10 ? '#c80000' : '#ff69b4';
              return (
                <span key={key} className="history-item" style={{ color }}>
                  {Number(item).toFixed(2)}x
                </span>
              );
            })}
          </div>
        </div>
        <i 
          className="fas fa-clock-rotate-left history-icon" 
          onClick={() => setShowHistory(!showHistory)}
        ></i>
      </div>

      <div className={`history-popup ${showHistory ? 'show' : ''}`}>
        <div className="popup-header">
          <span>Crash History</span>
          <button className="close-popup" onClick={() => setShowHistory(false)}>x</button>
        </div>
        <div className="popup-body">
          {history.length === 0 ? (
            <div style={{ color: '#666', fontSize: '12px' }}>No rounds yet</div>
          ) : (
            reversedHistory.map((item, key) => {
              const num = parseFloat(item);
              const className = num < 2 ? 'low' : num <= 10 ? 'mid' : 'high';
              return (
                <div key={key} className={`popup-item ${className}`}>
                  {Number(item).toFixed(2)}x
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
