export const CSS = `
.cbs-backdrop {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    animation: cbs-fade 0.12s ease-out;
}
@keyframes cbs-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cbs-rise { from { transform: translateY(8px) scale(0.99); opacity: 0; } to { transform: none; opacity: 1; } }
.cbs-panel {
    width: min(1080px, 94vw);
    height: min(800px, 90vh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 12px;
    background: var(--modal-background, var(--background-primary, #313338));
    color: var(--text-normal, var(--text-default, #dbdee1));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
    font-family: var(--font-primary, inherit);
    animation: cbs-rise 0.16s ease-out;
}
.cbs-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}
.cbs-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--header-primary, var(--text-strong, #f2f3f5));
    white-space: nowrap;
}
.cbs-where { display: flex; flex-wrap: wrap; gap: 6px; margin-left: 8px; }
.cbs-x {
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--interactive-normal, #b5bac1);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
}
.cbs-x:hover { background: var(--background-modifier-hover, rgba(78, 80, 88, 0.3)); color: var(--interactive-hover, #dbdee1); }
.cbs-body { flex: 1; display: flex; min-height: 0; }
.cbs-filters {
    width: 370px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    padding: 14px 16px 0;
    background: var(--background-secondary, var(--background-base-lower, #2b2d31));
    border-right: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}
.cbs-results { flex: 1; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 14px 16px 18px; }
.cbs-label {
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--header-secondary, var(--text-muted, #b5bac1));
}
.cbs-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cbs-chip {
    padding: 5px 11px;
    border: none;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    user-select: none;
    background: var(--background-modifier-accent, rgba(78, 80, 88, 0.48));
    color: var(--interactive-normal, #b5bac1);
    transition: background 0.1s, color 0.1s;
}
.cbs-chip:hover { color: var(--interactive-hover, #dbdee1); background: var(--background-modifier-selected, rgba(78, 80, 88, 0.6)); }
.cbs-chip.cbs-on { background: var(--brand-500, var(--brand-experiment, #5865f2)); color: #fff; }
.cbs-chip.cbs-dim { opacity: 0.35; pointer-events: none; }
.cbs-input {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 10px;
    border: none;
    border-radius: 8px;
    outline: none;
    font-size: 14px;
    font-family: inherit;
    background: var(--input-background, var(--background-tertiary, #1e1f22));
    color: var(--text-normal, #dbdee1);
    color-scheme: dark;
}
.cbs-input::placeholder { color: var(--text-muted, #949ba4); }
.cbs-input:focus { box-shadow: inset 0 0 0 2px var(--brand-500, #5865f2); }
.cbs-row { display: flex; gap: 8px; }
.cbs-row > * { flex: 1; }
.cbs-gap { margin-top: 8px; }
.cbs-hint { margin-top: 6px; font-size: 12px; color: var(--text-muted, #949ba4); }
.cbs-more {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    color: var(--text-link, #00a8fc);
}
.cbs-actions {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 8px;
    margin-top: auto;
    padding: 12px 0 14px;
    background: var(--background-secondary, var(--background-base-lower, #2b2d31));
}
.cbs-btn {
    flex: 1;
    padding: 9px 14px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: var(--brand-500, #5865f2);
    color: #fff;
}
.cbs-btn:hover { filter: brightness(1.1); }
.cbs-btn.cbs-plain { flex: 0 0 auto; background: var(--button-secondary-background, #4e5058); }
.cbs-btn:disabled { opacity: 0.5; cursor: default; }
.cbs-summary { font-size: 13px; color: var(--text-muted, #949ba4); line-height: 1.4; }
.cbs-count { font-size: 14px; font-weight: 600; color: var(--header-primary, #f2f3f5); }
.cbs-error { color: var(--text-danger, #f23f43); }
.cbs-hit {
    position: relative;
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    background: var(--background-secondary, var(--background-base-lower, #2b2d31));
    border: 1px solid transparent;
}
.cbs-hit:hover { border-color: var(--background-modifier-accent, rgba(78, 80, 88, 0.48)); background: var(--background-modifier-hover, rgba(78, 80, 88, 0.3)); }
.cbs-avatar { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; object-fit: cover; }
.cbs-main { flex: 1; min-width: 0; }
.cbs-meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
.cbs-name { font-weight: 600; color: var(--header-primary, #f2f3f5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cbs-time { font-size: 12px; color: var(--text-muted, #949ba4); white-space: nowrap; }
.cbs-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 8;
    -webkit-box-orient: vertical;
    font-size: 14px;
    line-height: 1.375;
    white-space: pre-wrap;
    word-break: break-word;
}
.cbs-markup { color: var(--text-normal, #dbdee1); }
.cbs-markup img.emoji, .cbs-markup img[class*="emoji"] { width: 1.375em; height: 1.375em; object-fit: contain; vertical-align: bottom; }
.cbs-markup a { color: var(--text-link, #00a8fc); }
.cbs-forward { font-size: 12px; font-style: italic; color: var(--text-muted, #949ba4); }
.cbs-thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.cbs-thumb { position: relative; }
.cbs-thumb img { display: block; width: 128px; height: 128px; object-fit: cover; border-radius: 8px; background: rgba(0, 0, 0, 0.25); }
.cbs-play {
    position: absolute;
    right: 5px;
    bottom: 5px;
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
}
.cbs-file { margin-top: 4px; font-size: 13px; color: var(--text-link, #00a8fc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cbs-copy {
    position: absolute;
    top: 8px;
    right: 10px;
    padding: 3px 8px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    opacity: 0;
    background: var(--background-tertiary, #1e1f22);
    color: var(--interactive-normal, #b5bac1);
}
.cbs-hit:hover .cbs-copy { opacity: 1; }
.cbs-copy:hover { color: var(--interactive-hover, #dbdee1); }
.cbs-empty { margin: auto; max-width: 340px; text-align: center; font-size: 14px; line-height: 1.5; color: var(--text-muted, #949ba4); }
.cbs-empty b { display: block; margin-bottom: 4px; font-size: 16px; color: var(--header-primary, #f2f3f5); }
.cbs-foot { padding: 6px 0 2px; text-align: center; font-size: 12px; color: var(--text-muted, #949ba4); }
.cbs-open {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    margin: 0 8px;
    cursor: pointer;
    color: var(--interactive-normal, #b5bac1);
}
.cbs-open:hover { color: var(--interactive-hover, #dbdee1); }
.cbs-kbd { padding: 1px 5px; border-radius: 4px; font-size: 12px; background: var(--background-tertiary, #1e1f22); }
.cbs-settings { display: flex; flex-direction: column; gap: 12px; color: var(--text-normal, #dbdee1); font-size: 14px; line-height: 1.5; }
.cbs-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.cbs-cheats { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 13px; }
.cbs-cheats code { color: var(--header-primary, #f2f3f5); }
@media (max-width: 760px) {
    .cbs-body { flex-direction: column; overflow-y: auto; }
    .cbs-filters { width: auto; border-right: none; overflow: visible; }
    .cbs-results { overflow: visible; }
}
`;
