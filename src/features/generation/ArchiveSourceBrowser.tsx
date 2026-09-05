import type { FormEvent } from "react";
import type { ArchiveEntry } from "../../../shared/contracts";
import { Icon } from "../../components/Icon";

export type ArchiveSourceBrowserProps = {
  entries: ArchiveEntry[];
  total: number;
  hasMore: boolean;
  loaded: boolean;
  catalogAvailable: boolean;
  loading: boolean;
  adding: boolean;
  error: string;
  search: string;
  selectedEntryId: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onSelect: (entryId: string) => void;
  onAdd: () => void;
  onBack: () => void;
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function plainBucket(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").trim() || "Archive";
}

export function ArchiveSourceBrowser({
  entries,
  total,
  hasMore,
  loaded,
  catalogAvailable,
  loading,
  adding,
  error,
  search,
  selectedEntryId,
  onSearchChange,
  onSearch,
  onClearSearch,
  onRetry,
  onLoadMore,
  onSelect,
  onAdd,
  onBack,
}: ArchiveSourceBrowserProps) {
  const selected = entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    onSearch();
  };

  return <section className="archive-source-browser" aria-label="Angelo Art Index">
    <header>
      <button type="button" className="link-btn" disabled={adding} onClick={onBack}><Icon name="arrow" size={13} /> Retained sources</button>
      <span><strong>Angelo Art Index</strong><small>Verified images only · your archive stays unchanged</small></span>
    </header>

    <form className="archive-source-search" role="search" onSubmit={submitSearch}>
      <Icon name="search" size={14} />
      <input aria-label="Search Angelo Art Index" value={search} maxLength={120} disabled={adding} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search artwork names" />
      <button type="submit" disabled={loading || adding}>Search</button>
    </form>

    {error ? <div className="archive-source-message error" role="alert"><span><strong>Art Index needs attention</strong><small>{error}</small></span><button type="button" className="btn btn-ghost" disabled={loading || adding} onClick={onRetry}>Try again</button></div> : null}
    {!error && loading && !entries.length ? <div className="archive-source-message" role="status"><Icon name="history" size={16} /><span><strong>Checking Angelo Art Index…</strong><small>Only safe, materializable images will appear.</small></span></div> : null}
    {!error && loaded && !catalogAvailable ? <div className="archive-source-message" role="status"><Icon name="archive" size={16} /><span><strong>Angelo Art Index is not available</strong><small>Restart the Creative Studio PC host, then try again. Your prompt is unchanged.</small></span><button type="button" className="btn btn-ghost" disabled={loading} onClick={onRetry}>Check again</button></div> : null}
    {!error && loaded && catalogAvailable && !entries.length && !loading ? <div className="archive-source-message" role="status"><Icon name="image" size={16} /><span><strong>No verified images match</strong><small>Try a shorter search or clear it to see all available index entries.</small></span>{search ? <button type="button" className="btn btn-ghost" onClick={onClearSearch}>Clear search</button> : null}</div> : null}

    {entries.length ? <>
      <div className="archive-source-results-head"><span><strong>Choose one image</strong><small>{total.toLocaleString()} available</small></span><em>A project copy is made only after Add to project.</em></div>
      <div className="archive-source-results" role="listbox" aria-label="Verified images from Angelo Art Index">
        {entries.map((entry) => <button
          type="button"
          role="option"
          aria-selected={entry.id === selectedEntryId}
          aria-label={`Select ${entry.displayName} from Angelo Art Index`}
          className={entry.id === selectedEntryId ? "selected" : ""}
          disabled={adding}
          key={entry.id}
          onClick={() => onSelect(entry.id)}
        >
          <span className="archive-source-icon"><Icon name="image" size={20} /></span>
          <span><strong>{entry.displayName}</strong><small>{plainBucket(entry.workBucket)}{entry.observedYear ? ` · ${entry.observedYear}` : ""}</small><em>{entry.extension.replace(/^\./, "").toUpperCase()} · {formatBytes(entry.size)}</em></span>
          {entry.id === selectedEntryId ? <Icon name="check" size={13} /> : null}
        </button>)}
      </div>
      {hasMore ? <button type="button" className="btn btn-ghost archive-source-more" disabled={loading || adding} onClick={onLoadMore}>{loading ? "Loading…" : "Load more images"}</button> : null}
    </> : null}

    <footer>
      <span><strong>{selected?.displayName ?? "Choose an image"}</strong><small>{selected ? "Creative Studio will make one verified project copy. Training stays off." : "Nothing is copied until you confirm."}</small></span>
      <button type="button" className="btn btn-primary" disabled={!selected || loading || adding} onClick={onAdd}>{adding ? "Adding…" : "Add to project"}</button>
    </footer>
  </section>;
}
