import { useEffect, useRef } from "react";

import { formatTimestamp } from "../lib/audio";
import type { Segment } from "../lib/segments";
import { speakerColor, speakerLabel } from "../lib/speakerStyle";
import "./SegmentList.css";

export interface SegmentListProps {
  segments: Segment[];
  follow: boolean;
}

/** Chronological log of "who spoke when", newest kept in view while a stream is running. */
export function SegmentList({ segments, follow }: SegmentListProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!follow) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [follow, segments.length]);

  return (
    <section className="segments">
      <header className="segments__header">
        <h2>Speaker turns</h2>
        <span className="segments__count">{segments.length}</span>
      </header>

      {segments.length === 0 ? (
        <p className="segments__empty">No speech detected yet.</p>
      ) : (
        <ol className="segments__list" ref={listRef}>
          {segments.map((segment) => (
            <li
              key={`${segment.speaker}-${segment.start}`}
              className="segment"
              style={{ "--segment-color": speakerColor(segment.speaker) } as React.CSSProperties}
            >
              <span className="segment__rail" />
              <span className="segment__speaker">{speakerLabel(segment.speaker)}</span>
              <span className="segment__range">
                {formatTimestamp(segment.start)} – {formatTimestamp(segment.end)}
              </span>
              <span className="segment__duration">{(segment.end - segment.start).toFixed(1)}s</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
