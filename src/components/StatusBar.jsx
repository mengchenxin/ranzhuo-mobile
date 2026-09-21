import { useEffect, useState } from "react";
import { Radio, Wifi } from "lucide-react";

function getClock() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function StatusBar() {
  const [time, setTime] = useState(getClock);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(getClock()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="status-bar" aria-hidden="true">
      <span>{time}</span>
      <div className="status-bar__signals">
        <Radio size={14} strokeWidth={2.4} />
        <Wifi size={15} strokeWidth={2.4} />
        <span className="status-bar__battery">
          <i />
        </span>
      </div>
    </div>
  );
}
