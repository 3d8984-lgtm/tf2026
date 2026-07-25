import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/contexts/LangContext";

/**
 * value / onChange use "YYYY-MM-DDTHH:MM" (local, same as <input type="datetime-local">),
 * so callers already using new Date(value) continue to work unchanged.
 */
interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function parseValue(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || "");
  if (!m) {
    const d = new Date();
    return { date: d, hour12: ((d.getHours() + 11) % 12) + 1, minute: d.getMinutes(), ampm: d.getHours() >= 12 ? "PM" : "AM" as "AM" | "PM" };
  }
  const [, y, mo, da, hh, mm] = m;
  const h24 = parseInt(hh, 10);
  const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const hour12 = ((h24 + 11) % 12) + 1;
  return { date: new Date(parseInt(y), parseInt(mo) - 1, parseInt(da)), hour12, minute: parseInt(mm), ampm };
}

export function DateTimePicker({ value, onChange, className }: Props) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const parsed = useMemo(() => parseValue(value), [value]);
  const [date, setDate] = useState<Date>(parsed.date);
  const [hourStr, setHourStr] = useState<string>(String(parsed.hour12));
  const [minStr, setMinStr] = useState<string>(pad(parsed.minute));
  const [ampm, setAmpm] = useState<"AM" | "PM">(parsed.ampm);

  useEffect(() => {
    const p = parseValue(value);
    setDate(p.date);
    setHourStr(String(p.hour12));
    setMinStr(pad(p.minute));
    setAmpm(p.ampm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (d: Date, h12: number, m: number, ap: "AM" | "PM") => {
    const hClamped = Math.min(12, Math.max(1, h12));
    const mClamped = Math.min(59, Math.max(0, m));
    let h24 = hClamped % 12;
    if (ap === "PM") h24 += 12;
    const out = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h24)}:${pad(mClamped)}`;
    onChange(out);
  };

  const commitHour = () => {
    const n = parseInt(hourStr, 10);
    const safe = isNaN(n) ? 12 : Math.min(12, Math.max(1, n));
    setHourStr(String(safe));
    emit(date, safe, parseInt(minStr, 10) || 0, ampm);
  };
  const commitMin = () => {
    const n = parseInt(minStr, 10);
    const safe = isNaN(n) ? 0 : Math.min(59, Math.max(0, n));
    setMinStr(pad(safe));
    emit(date, parseInt(hourStr, 10) || 12, safe, ampm);
  };

  return (
    <div className={cn("flex gap-2 items-center", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="flex-1 justify-start text-left font-normal h-9"
          >
            <CalendarIcon className="w-4 h-4 mr-2" />
            {date ? format(date, "yyyy-MM-dd") : <span className="text-muted-foreground">{isKo ? "날짜 선택" : "选择日期"}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              if (!d) return;
              setDate(d);
              emit(d, parseInt(hourStr, 10) || 12, parseInt(minStr, 10) || 0, ampm);
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>

      <Input
        type="text"
        inputMode="numeric"
        value={hourStr}
        onChange={(e) => setHourStr(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
        onBlur={commitHour}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-12 text-center h-9 px-1"
        placeholder="12"
        aria-label={isKo ? "시" : "时"}
      />
      <span className="text-muted-foreground">:</span>
      <Input
        type="text"
        inputMode="numeric"
        value={minStr}
        onChange={(e) => setMinStr(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
        onBlur={commitMin}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-12 text-center h-9 px-1"
        placeholder="00"
        aria-label={isKo ? "분" : "分"}
      />

      <div className="flex rounded-md border overflow-hidden shrink-0">
        <button
          type="button"
          onClick={() => { setAmpm("AM"); emit(date, parseInt(hourStr, 10) || 12, parseInt(minStr, 10) || 0, "AM"); }}
          className={cn(
            "px-2 h-9 text-xs transition-colors",
            ampm === "AM" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
          )}
        >
          {isKo ? "오전" : "上午"}
        </button>
        <button
          type="button"
          onClick={() => { setAmpm("PM"); emit(date, parseInt(hourStr, 10) || 12, parseInt(minStr, 10) || 0, "PM"); }}
          className={cn(
            "px-2 h-9 text-xs transition-colors border-l",
            ampm === "PM" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
          )}
        >
          {isKo ? "오후" : "下午"}
        </button>
      </div>
    </div>
  );
}

export default DateTimePicker;
