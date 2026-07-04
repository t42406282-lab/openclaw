// Control UI view renders the Daylog automatic work journal tab.
import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import {
  askDaylog,
  configureDaylogPolling,
  getDaylogState,
  loadDaylog,
  loadDaylogFramePreview,
  loadDaylogStandup,
  localDayKey,
  runDaylogAnalysisNow,
  setDaylogCapturePaused,
  shiftDay,
  type DaylogCardPayload,
  type DaylogStatusPayload,
  type DaylogUiState,
} from "../controllers/daylog.ts";
import { formatTimeMs } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";

export type DaylogProps = {
  host: object;
  client: GatewayBrowserClient | null;
  connected: boolean;
  pluginEnabled: boolean | null;
  onRequestUpdate?: () => void;
};

function formatClock(ms: number): string {
  return formatTimeMs(ms, { hour: "2-digit", minute: "2-digit" }, "");
}

function formatDurationMs(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return t("daylog.duration.minutes", { minutes: String(minutes) });
  }
  const hours = Math.floor(minutes / 60);
  return t("daylog.duration.hours", { hours: String(hours), minutes: String(minutes % 60) });
}

/** Stable category hue so colors stay consistent across renders and days. */
function categoryHue(category: string): number {
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) {
    hash = (hash * 31 + category.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function renderStatusChips(status: DaylogStatusPayload): TemplateResult {
  const capturing = status.captureEnabled && !status.capturePaused && !status.lastCaptureError;
  const captureLabel = status.capturePaused
    ? t("daylog.status.paused")
    : status.captureEnabled
      ? t("daylog.status.capturing", { seconds: String(status.captureIntervalSeconds) })
      : t("daylog.status.disabled");
  return html`
    <div class="daylog__chips">
      <span class="daylog__chip ${capturing ? "daylog__chip--ok" : "daylog__chip--warn"}">
        <span class="daylog__chip-dot"></span>
        ${captureLabel}
      </span>
      ${status.nodeName || status.nodeId
        ? html`<span class="daylog__chip" title=${t("daylog.status.nodeHelp")}>
            ${icons.monitor} ${status.nodeName ?? status.nodeId}
          </span>`
        : nothing}
      ${status.pendingFrames > 0
        ? html`<span class="daylog__chip" title=${t("daylog.status.pendingHelp")}>
            ${t("daylog.status.pending", { count: String(status.pendingFrames) })}
          </span>`
        : nothing}
      ${status.analysisRunning
        ? html`<span class="daylog__chip daylog__chip--busy">${t("daylog.status.analyzing")}</span>`
        : nothing}
      ${status.lastCaptureError
        ? html`<span class="daylog__chip daylog__chip--error" title=${status.lastCaptureError}>
            ${t("daylog.status.captureError")}
          </span>`
        : nothing}
      ${status.lastBatch?.status === "error"
        ? html`<span class="daylog__chip daylog__chip--error" title=${status.lastBatch.error ?? ""}>
            ${t("daylog.status.batchError")}
          </span>`
        : nothing}
      ${status.visionModelSource === "missing"
        ? html`<span
            class="daylog__chip daylog__chip--warn"
            title=${t("daylog.status.modelMissingHelp")}
          >
            ${t("daylog.status.modelMissing")}
          </span>`
        : nothing}
    </div>
  `;
}

function renderCard(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
  card: DaylogCardPayload,
): TemplateResult {
  const expanded = state.expandedCardIds.has(card.id);
  const hue = categoryHue(card.category);
  const preview =
    card.keyframeId !== undefined ? state.framePreviews.get(card.keyframeId) : undefined;
  if (expanded && card.keyframeId !== undefined && !preview) {
    void loadDaylogFramePreview(state, client, card.keyframeId);
  }
  return html`
    <article
      class="daylog-card ${expanded ? "daylog-card--expanded" : ""}"
      style="--daylog-hue: ${hue}"
    >
      <button
        class="daylog-card__header"
        type="button"
        @click=${() => {
          const next = new Set(state.expandedCardIds);
          if (expanded) {
            next.delete(card.id);
          } else {
            next.add(card.id);
          }
          state.expandedCardIds = next;
          state.requestUpdate?.();
        }}
      >
        <span class="daylog-card__time">
          ${formatClock(card.startMs)}<span class="daylog-card__time-sep">–</span>${formatClock(
            card.endMs,
          )}
        </span>
        <span class="daylog-card__stripe" aria-hidden="true"></span>
        <span class="daylog-card__heading">
          <span class="daylog-card__title">${card.title}</span>
          <span class="daylog-card__summary">${card.summary}</span>
        </span>
        <span class="daylog-card__meta">
          <span class="daylog-card__category">${card.category}</span>
          ${card.appPrimary
            ? html`<span class="daylog-card__app">${card.appPrimary}</span>`
            : nothing}
          <span class="daylog-card__duration">${formatDurationMs(card.endMs - card.startMs)}</span>
        </span>
      </button>
      ${expanded
        ? html`
            <div class="daylog-card__body">
              ${preview
                ? html`<img
                    class="daylog-card__keyframe"
                    src=${preview}
                    alt=${t("daylog.card.keyframeAlt")}
                  />`
                : card.keyframeId !== undefined
                  ? html`<div class="daylog-card__keyframe daylog-card__keyframe--loading">
                      ${t("common.loading")}
                    </div>`
                  : nothing}
              ${card.detail ? html`<p class="daylog-card__detail">${card.detail}</p>` : nothing}
              ${card.distractions.length > 0
                ? html`
                    <div class="daylog-card__distractions">
                      <span class="daylog-card__distractions-label">
                        ${t("daylog.card.distractions")}
                      </span>
                      ${card.distractions.map(
                        (distraction) => html`
                          <span class="daylog-card__distraction">
                            ${formatClock(distraction.startMs)} · ${distraction.title}
                          </span>
                        `,
                      )}
                    </div>
                  `
                : nothing}
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderStats(state: DaylogUiState): TemplateResult | typeof nothing {
  const stats = state.timeline?.stats;
  if (!stats || stats.trackedMs <= 0) {
    return nothing;
  }
  const focusMs = Math.max(0, stats.trackedMs - stats.distractionMs);
  const focusPct = Math.round((focusMs / stats.trackedMs) * 100);
  const maxCategoryMs = stats.categories[0]?.ms ?? 1;
  return html`
    <section class="card daylog-side__card">
      <div class="card-title">${t("daylog.stats.title")}</div>
      <div class="daylog-stats__focus">
        <div class="daylog-stats__focus-bar">
          <div class="daylog-stats__focus-fill" style="width: ${focusPct}%"></div>
        </div>
        <div class="daylog-stats__focus-legend">
          <span>${t("daylog.stats.focus", { pct: String(focusPct) })}</span>
          <span>${t("daylog.stats.tracked", { duration: formatDurationMs(stats.trackedMs) })}</span>
        </div>
      </div>
      <div class="daylog-stats__categories">
        ${stats.categories.slice(0, 6).map(
          (entry) => html`
            <div
              class="daylog-stats__category"
              style="--daylog-hue: ${categoryHue(entry.category)}"
            >
              <span class="daylog-stats__category-name">${entry.category}</span>
              <span class="daylog-stats__category-bar">
                <span
                  class="daylog-stats__category-fill"
                  style="width: ${Math.max(6, Math.round((entry.ms / maxCategoryMs) * 100))}%"
                ></span>
              </span>
              <span class="daylog-stats__category-time">${formatDurationMs(entry.ms)}</span>
            </div>
          `,
        )}
      </div>
      ${stats.apps.length > 0
        ? html`
            <div class="daylog-stats__apps">
              ${stats.apps
                .slice(0, 5)
                .map((app) => html`<span class="daylog-stats__app">${app.domain}</span>`)}
            </div>
          `
        : nothing}
    </section>
  `;
}

function renderStandup(state: DaylogUiState, client: GatewayBrowserClient | null): TemplateResult {
  return html`
    <section class="card daylog-side__card">
      <div class="daylog-side__card-header">
        <div class="card-title">${t("daylog.standup.title")}</div>
        <button
          class="btn btn--small"
          type="button"
          ?disabled=${state.standupLoading}
          @click=${() => void loadDaylogStandup(state, client, state.standup !== null)}
        >
          ${state.standupLoading
            ? t("common.loading")
            : state.standup
              ? t("daylog.standup.refresh")
              : t("daylog.standup.generate")}
        </button>
      </div>
      ${state.standup
        ? html`<div class="daylog-standup__body markdown-body">
            ${unsafeHTML(toSanitizedMarkdownHtml(state.standup.text))}
          </div>`
        : html`<div class="card-sub">${t("daylog.standup.empty")}</div>`}
    </section>
  `;
}

function renderAsk(state: DaylogUiState, client: GatewayBrowserClient | null): TemplateResult {
  return html`
    <section class="card daylog-side__card">
      <div class="card-title">${t("daylog.ask.title")}</div>
      <form
        class="daylog-ask__form"
        @submit=${(event: Event) => {
          event.preventDefault();
          void askDaylog(state, client);
        }}
      >
        <input
          class="daylog-ask__input"
          type="text"
          .value=${state.askQuestion}
          placeholder=${t("daylog.ask.placeholder")}
          @input=${(event: Event) => {
            state.askQuestion = (event.target as HTMLInputElement).value;
          }}
        />
        <button class="btn btn--small" type="submit" ?disabled=${state.askLoading}>
          ${state.askLoading ? t("common.loading") : t("daylog.ask.submit")}
        </button>
      </form>
      ${state.askAnswer ? html`<p class="daylog-ask__answer">${state.askAnswer}</p>` : nothing}
    </section>
  `;
}

export function renderDaylog(props: DaylogProps) {
  const state = getDaylogState(props.host);
  state.requestUpdate = props.onRequestUpdate ?? null;
  const active = props.connected && props.pluginEnabled === true;
  configureDaylogPolling(state, active ? props.client : null, active);
  if (active && !state.timeline && !state.loading && !state.error) {
    void loadDaylog(state, props.client);
  }

  if (props.pluginEnabled === null) {
    return html`
      <section class="card lazy-view-state lazy-view-state--loading">
        <div class="card-title">${t("lazyView.loadingTitle")}</div>
        <div class="card-sub">${t("common.loading")}</div>
      </section>
    `;
  }
  if (!props.pluginEnabled) {
    return html`
      <section class="daylog">
        <div class="callout">
          ${t("daylog.disabledHelpStart")}
          <code>${t("daylog.enableConfigKey")}</code>
          ${t("daylog.disabledHelpEnd")}
        </div>
      </section>
    `;
  }

  const isToday = state.day === localDayKey();
  const cards = state.timeline?.cards ?? [];
  return html`
    <section class="daylog">
      <header class="daylog__header">
        <div class="daylog__daynav">
          <button
            class="btn btn--small"
            type="button"
            aria-label=${t("daylog.nav.previousDay")}
            @click=${() => void loadDaylog(state, props.client, { day: shiftDay(state.day, -1) })}
          >
            ‹
          </button>
          <span class="daylog__day">${state.day}</span>
          <button
            class="btn btn--small"
            type="button"
            aria-label=${t("daylog.nav.nextDay")}
            ?disabled=${isToday}
            @click=${() => void loadDaylog(state, props.client, { day: shiftDay(state.day, 1) })}
          >
            ›
          </button>
          ${!isToday
            ? html`<button
                class="btn btn--small"
                type="button"
                @click=${() => void loadDaylog(state, props.client, { day: localDayKey() })}
              >
                ${t("daylog.nav.today")}
              </button>`
            : nothing}
        </div>
        ${state.status ? renderStatusChips(state.status) : nothing}
        <div class="daylog__actions">
          ${state.status
            ? html`<button
                class="btn btn--small"
                type="button"
                ?disabled=${state.actionPending || !state.status.captureEnabled}
                @click=${() =>
                  void setDaylogCapturePaused(state, props.client, !state.status?.capturePaused)}
              >
                ${state.status.capturePaused
                  ? t("daylog.actions.resume")
                  : t("daylog.actions.pause")}
              </button>`
            : nothing}
          <button
            class="btn btn--small"
            type="button"
            ?disabled=${state.actionPending}
            @click=${() => void runDaylogAnalysisNow(state, props.client)}
          >
            ${t("daylog.actions.analyzeNow")}
          </button>
          <button
            class="btn btn--small"
            type="button"
            ?disabled=${state.loading}
            @click=${() => void loadDaylog(state, props.client)}
          >
            ${icons.refresh}
          </button>
        </div>
      </header>
      ${state.error ? html`<div class="callout danger" role="alert">${state.error}</div>` : nothing}
      <div class="daylog__layout">
        <div class="daylog__timeline">
          ${state.loading && cards.length === 0
            ? html`<div class="card-sub">${t("common.loading")}</div>`
            : nothing}
          ${!state.loading && cards.length === 0 && !state.error
            ? html`
                <div class="daylog__empty">
                  <div class="daylog__empty-title">${t("daylog.empty.title")}</div>
                  <div class="daylog__empty-sub">${t("daylog.empty.subtitle")}</div>
                </div>
              `
            : nothing}
          ${cards.map((card) => renderCard(state, props.client, card))}
        </div>
        <aside class="daylog__side">
          ${renderStats(state)} ${renderStandup(state, props.client)}
          ${renderAsk(state, props.client)}
        </aside>
      </div>
    </section>
  `;
}
