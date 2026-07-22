/**
 * Scroll-spy + animated rail indicator. Active heading tracked via a single
 * IntersectionObserver; the dash slides by arc-length so it weaves through the
 * rail's curves instead of cutting across.
 */

import { mount } from "@cloudflare/nimbus-docs/client";

const READING_BAND = 0.25;
const BOTTOM_EPSILON = 2;
const REVEAL_PADDING = 12;

// Arc length of a straight segment.
function lineLength(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

// Arc length of a cubic Bézier, approximated by summing chords between sampled
// points. 24 samples is sub-pixel accurate for the gentle S-curves the rail uses.
function cubicLength(
  ax: number,
  ay: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  bx: number,
  by: number,
): number {
  const STEPS = 24;
  let prevX = ax;
  let prevY = ay;
  let len = 0;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const e = t * t * t;
    const x = a * ax + b * c1x + c * c2x + e * bx;
    const y = a * ay + b * c1y + c * c2y + e * by;
    len += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return len;
}

function initToc(root: HTMLElement): () => void {
  const nav = root.querySelector<HTMLElement>("nav");
  const activePath = root.querySelector<SVGPathElement>("[data-nb-toc-rail-active]");
  const links = root.querySelectorAll<HTMLElement>("[data-nb-toc-link]");
  if (!nav || !activePath || links.length === 0) return () => {};

  const scrollHost = root.closest<HTMLElement>("[data-nb-toc-scroll-host]") ?? root;
  const slugs = Array.from(links).map((l) => l.dataset.nbSlug!);
  const headingEls = slugs
    .map((s) => document.getElementById(s))
    .filter(Boolean) as HTMLElement[];
  if (headingEls.length === 0) return () => {};

  let segments: { start: number; length: number }[] = [];
  let totalLength = 0;
  let currentIndex = -1;
  let currentLink: HTMLElement | null = null;
  let hasApplied = false;

  // Measure the rail from the DOM so the path stays pixel-perfect over the
  // static gray rail, capturing each link's arc-length range as we go.
  function buildRail() {
    const navRect = nav!.getBoundingClientRect();

    const m = Array.from(links).map((link) => {
      const r = link.getBoundingClientRect();
      return {
        x: r.left - navRect.left + 1,
        yTop: r.top - navRect.top,
        yBot: r.top - navRect.top + r.height,
      };
    });

    let d = "";
    const newSegments: { start: number; length: number }[] = [];

    // Lengths are computed analytically (line = Euclidean distance, cubic =
    // sampled chord sum) rather than by writing each sub-path to the DOM and
    // reading getTotalLength(). That old approach interleaved a live-element
    // write with a geometry read on every iteration — a forced synchronous
    // reflow per heading. Arc length is additive across contiguous commands, so
    // summing the isolated pieces matches the total; `d` is written back once.
    let cumulative = 0;
    let prevX = 0;
    let prevYBot = 0;

    for (let i = 0; i < m.length; i++) {
      const cur = m[i];

      if (i === 0) {
        d += `M ${cur.x} ${cur.yTop} `;
      } else {
        const prev = m[i - 1];
        let connector: string;
        let connectorLength: number;
        if (Math.abs(cur.x - prev.x) < 0.5) {
          connector = `L ${cur.x} ${cur.yTop} `;
          connectorLength = lineLength(prevX, prevYBot, cur.x, cur.yTop);
        } else {
          // Indent change → S-curve matching the static gap SVG.
          const midY = (prev.yBot + cur.yTop) / 2;
          connector = `C ${prev.x} ${midY}, ${cur.x} ${midY}, ${cur.x} ${cur.yTop} `;
          connectorLength = cubicLength(prevX, prevYBot, prev.x, midY, cur.x, midY, cur.x, cur.yTop);
        }
        d += connector;
        cumulative += connectorLength;
      }

      const start = cumulative;

      const seg = `L ${cur.x} ${cur.yBot} `;
      d += seg;
      cumulative += lineLength(cur.x, cur.yTop, cur.x, cur.yBot);

      newSegments.push({ start, length: cumulative - start });

      prevX = cur.x;
      prevYBot = cur.yBot;
    }

    activePath!.setAttribute("d", d);
    segments = newSegments;
    totalLength = cumulative;
  }

  function applyActive(index: number, instant: boolean) {
    const seg = segments[index];
    if (!seg) return;

    if (instant) {
      activePath!.setAttribute("data-initial", "true");
      // Force recalc so only opacity transitions on first paint (no dash sweep).
      void activePath!.getBoundingClientRect();
    }

    activePath!.style.strokeDasharray = `${seg.length} ${totalLength + 1}`;
    activePath!.style.strokeDashoffset = `${-seg.start}`;

    if (instant) {
      requestAnimationFrame(() => {
        activePath!.setAttribute("data-ready", "true");
        requestAnimationFrame(() => {
          activePath!.removeAttribute("data-initial");
        });
      });
    }
  }

  function revealActiveLink(link: HTMLElement) {
    const hostRect = scrollHost.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();

    if (linkRect.top < hostRect.top + REVEAL_PADDING) {
      scrollHost.scrollTop += linkRect.top - hostRect.top - REVEAL_PADDING;
      return;
    }

    if (linkRect.bottom > hostRect.bottom - REVEAL_PADDING) {
      scrollHost.scrollTop += linkRect.bottom - hostRect.bottom + REVEAL_PADDING;
    }
  }

  function setActive(index: number) {
    if (index === currentIndex) return;
    currentIndex = index;

    currentLink?.removeAttribute("aria-current");
    const activeLink = links[index] ?? null;
    activeLink?.setAttribute("aria-current", "true");
    currentLink = activeLink;
    if (activeLink) revealActiveLink(activeLink);

    applyActive(index, !hasApplied);
    hasApplied = true;
  }

  const inBand = new Set<number>();
  let observedIndex = 0;
  let atBottom = false;
  let pinnedIndex: number | null = null;
  let pinnedEnteredViewport = false;

  function resolve() {
    if (pinnedIndex !== null) {
      setActive(pinnedIndex);
      return;
    }
    setActive(atBottom ? headingEls.length - 1 : observedIndex);
  }

  // rootMargin collapses the root to the top band; deepest in-band heading wins.
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const i = headingEls.indexOf(entry.target as HTMLElement);
        if (i === -1) continue;
        if (entry.isIntersecting) inBand.add(i);
        else inBand.delete(i);
      }
      if (inBand.size > 0) observedIndex = Math.max(...inBand);
      resolve();
    },
    { rootMargin: `0px 0px -${(1 - READING_BAND) * 100}% 0px`, threshold: 0 },
  );
  headingEls.forEach((h) => spy.observe(h));

  function updateBottom() {
    const scrollEl = document.scrollingElement ?? document.documentElement;
    const maxScroll = scrollEl.scrollHeight - window.innerHeight;
    const next =
      maxScroll > BOTTOM_EPSILON &&
      scrollEl.scrollTop >= maxScroll - BOTTOM_EPSILON;
    if (next !== atBottom) {
      atBottom = next;
      resolve();
    }
  }

  function updateObservedIndex() {
    const bandBottom = window.innerHeight * READING_BAND;
    let nextIndex = 0;
    for (let i = 0; i < headingEls.length; i++) {
      if (headingEls[i].getBoundingClientRect().top <= bandBottom) nextIndex = i;
      else break;
    }
    observedIndex = nextIndex;
  }

  function releaseStalePin() {
    if (pinnedIndex === null) return;
    const heading = document.getElementById(slugs[pinnedIndex]);
    if (!heading) {
      pinnedIndex = null;
      pinnedEnteredViewport = false;
      return;
    }

    const rect = heading.getBoundingClientRect();
    const inViewport = rect.bottom >= 0 && rect.top <= window.innerHeight;
    if (inViewport) {
      pinnedEnteredViewport = true;
      return;
    }

    if (pinnedEnteredViewport) {
      pinnedIndex = null;
      pinnedEnteredViewport = false;
    }
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateObservedIndex();
      updateBottom();
      releaseStalePin();
      resolve();
      ticking = false;
    });
  }

  function onLayoutChange() {
    buildRail();
    updateObservedIndex();
    updateBottom();
    releaseStalePin();
    resolve();
    if (currentIndex >= 0) {
      applyActive(currentIndex, true);
      const activeLink = links[currentIndex];
      if (activeLink) revealActiveLink(activeLink);
    }
  }

  const controller = new AbortController();

  nav.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest<HTMLElement>("[data-nb-toc-link]");
      if (!link) return;
      const i = slugs.indexOf(link.dataset.nbSlug!);
      if (i === -1) return;
      pinnedIndex = i;
      const heading = document.getElementById(slugs[i]);
      const rect = heading?.getBoundingClientRect();
      pinnedEnteredViewport = !!rect && rect.bottom >= 0 && rect.top <= window.innerHeight;
      resolve();
    },
    { signal: controller.signal },
  );

  // Hand-driven scrolling releases the pin and resumes auto-tracking.
  function releasePin() {
    if (pinnedIndex === null) return;
    pinnedIndex = null;
    pinnedEnteredViewport = false;
    resolve();
  }
  const NAV_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
    "Spacebar",
  ]);
  window.addEventListener("wheel", releasePin, {
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener("touchmove", releasePin, {
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (NAV_KEYS.has(e.key)) releasePin();
    },
    { signal: controller.signal },
  );

  window.addEventListener("scroll", onScroll, {
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener("resize", onLayoutChange, {
    passive: true,
    signal: controller.signal,
  });

  const ro = new ResizeObserver(onLayoutChange);
  ro.observe(nav);

  buildRail();
  updateObservedIndex();
  updateBottom();
  resolve();

  return () => {
    controller.abort();
    ro.disconnect();
    spy.disconnect();
  };
}

mount("[data-nb-toc]", initToc);
