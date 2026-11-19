/**
 * Sonic SVG Interactive Growth & Compounding Chart
 * Dual-line high performance chart comparing Compounded vs. Linear Growth
 */

(function (root) {
  'use strict';

  function renderChart(container, timeline, options = {}) {
    if (!container || !timeline || timeline.length < 2) return;

    container.innerHTML = '';
    const width = container.clientWidth || 600;
    const height = options.height || 280;
    const padLeft = 60;
    const padRight = 30;
    const padTop = 20;
    const padBottom = 40;

    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Find min and max values
    let minVal = 0;
    let maxVal = 0;

    timeline.forEach(pt => {
      const v1 = options.mode === 'cash' ? pt.compBalance : pt.gainPct;
      const v2 = options.mode === 'cash' ? pt.linearBalance : pt.linearGainPct;
      if (v1 > maxVal) maxVal = v1;
      if (v2 > maxVal) maxVal = v2;
      if (v1 < minVal) minVal = v1;
      if (v2 < minVal) minVal = v2;
    });

    if (maxVal === minVal) maxVal += 10;
    // Add 10% breathing room to max
    maxVal = maxVal * 1.08;

    const getX = (idx) => padLeft + (idx / (timeline.length - 1)) * plotW;
    const getY = (val) => padTop + plotH - ((val - minVal) / (maxVal - minVal)) * plotH;

    // Build SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'sonic-svg-chart');
    svg.style.width = '100%';
    svg.style.height = `${height}px`;

    // Defs for gradients
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="compAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00e676" stop-opacity="0.32" />
        <stop offset="100%" stop-color="#00e676" stop-opacity="0.0" />
      </linearGradient>
      <linearGradient id="compLineGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#10b981" />
        <stop offset="100%" stop-color="#00e676" />
      </linearGradient>
    `;
    svg.appendChild(defs);

    // Grid lines (horizontal)
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridGroup.setAttribute('class', 'grid-lines');
    const yTicksCount = 5;
    for (let i = 0; i <= yTicksCount; i++) {
      const v = minVal + (i / yTicksCount) * (maxVal - minVal);
      const y = getY(v);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padLeft);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - padRight);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.07)');
      line.setAttribute('stroke-dasharray', '3,3');
      gridGroup.appendChild(line);

      // Label
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', padLeft - 10);
      txt.setAttribute('y', y + 4);
      txt.setAttribute('text-anchor', 'end');
      txt.setAttribute('fill', 'rgba(255, 255, 255, 0.45)');
      txt.setAttribute('font-size', '11');
      txt.setAttribute('font-family', 'sans-serif');
      txt.textContent = options.mode === 'cash' ? `$${Math.round(v).toLocaleString()}` : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
      gridGroup.appendChild(txt);
    }
    svg.appendChild(gridGroup);

    // X-Axis date labels (5 ticks)
    const xGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const xTicks = 5;
    for (let i = 0; i < xTicks; i++) {
      const idx = Math.floor((i / (xTicks - 1)) * (timeline.length - 1));
      const pt = timeline[idx];
      const x = getX(idx);

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', x);
      txt.setAttribute('y', height - 12);
      txt.setAttribute('text-anchor', i === 0 ? 'start' : i === xTicks - 1 ? 'end' : 'middle');
      txt.setAttribute('fill', 'rgba(255, 255, 255, 0.5)');
      txt.setAttribute('font-size', '11');
      txt.textContent = formatDateLabel(pt.date);
      xGroup.appendChild(txt);
    }
    svg.appendChild(xGroup);

    // Linear Path (Comparison - dashed cyan)
    let linearD = '';
    timeline.forEach((pt, idx) => {
      const x = getX(idx);
      const y = getY(options.mode === 'cash' ? pt.linearBalance : pt.linearGainPct);
      linearD += `${idx === 0 ? 'M' : 'L'} ${x} ${y} `;
    });

    const linearPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    linearPath.setAttribute('d', linearD);
    linearPath.setAttribute('fill', 'none');
    linearPath.setAttribute('stroke', '#38bdf8');
    linearPath.setAttribute('stroke-width', '1.8');
    linearPath.setAttribute('stroke-dasharray', '4,4');
    linearPath.setAttribute('opacity', '0.75');
    svg.appendChild(linearPath);

    // Compounded Area & Path (Primary - glowing emerald)
    const splitIdx = timeline.findIndex(pt => pt.isForecast);
    const hasForecast = splitIdx >= 0;
    const isPureForecast = splitIdx === 1 || splitIdx === 0;
    const histEnd = (hasForecast && !isPureForecast) ? splitIdx : (isPureForecast ? 0 : timeline.length - 1);

    let compHistD = '';
    if (histEnd > 0) {
      for (let idx = 0; idx <= histEnd; idx++) {
        const pt = timeline[idx];
        const x = getX(idx);
        const y = getY(options.mode === 'cash' ? pt.compBalance : pt.gainPct);
        compHistD += `${idx === 0 ? 'M' : 'L'} ${x} ${y} `;
      }
    }

    let compForecastD = '';
    const fStart = isPureForecast ? 0 : splitIdx;
    if (hasForecast && fStart >= 0) {
      for (let idx = fStart; idx < timeline.length; idx++) {
        const pt = timeline[idx];
        const x = getX(idx);
        const y = getY(options.mode === 'cash' ? pt.compBalance : pt.gainPct);
        compForecastD += `${idx === fStart ? 'M' : 'L'} ${x} ${y} `;
      }
    }

    const bottomY = getY(minVal);

    // Historical Area & Line
    if (histEnd > 0 && compHistD) {
      const firstX = getX(0);
      const histLastX = getX(histEnd);
      const areaHistD = `${compHistD} L ${histLastX} ${bottomY} L ${firstX} ${bottomY} Z`;

      const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      areaPath.setAttribute('d', areaHistD);
      areaPath.setAttribute('fill', 'url(#compAreaGrad)');
      svg.appendChild(areaPath);

      const compLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      compLine.setAttribute('d', compHistD);
      compLine.setAttribute('fill', 'none');
      compLine.setAttribute('stroke', 'url(#compLineGrad)');
      compLine.setAttribute('stroke-width', '2.6');
      compLine.setAttribute('stroke-linecap', 'round');
      svg.appendChild(compLine);
    }

    // Forecast Area & Glowing Dashed Line
    if (hasForecast && compForecastD) {
      const fStartX = getX(fStart);
      const lastX = getX(timeline.length - 1);
      const areaForecastD = `${compForecastD} L ${lastX} ${bottomY} L ${fStartX} ${bottomY} Z`;
      const fArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fArea.setAttribute('d', areaForecastD);
      fArea.setAttribute('fill', 'url(#compAreaGrad)');
      fArea.setAttribute('opacity', '0.45');
      svg.appendChild(fArea);

      const fLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fLine.setAttribute('d', compForecastD);
      fLine.setAttribute('fill', 'none');
      fLine.setAttribute('stroke', '#00e5ff');
      fLine.setAttribute('stroke-width', '2.6');
      fLine.setAttribute('stroke-dasharray', '6,4');
      fLine.setAttribute('stroke-linecap', 'round');
      svg.appendChild(fLine);

      // Transition marker line (only if there was historical data preceding forecast)
      if (splitIdx > 1) {
        const splitX = getX(splitIdx);
        const mLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        mLine.setAttribute('x1', splitX);
        mLine.setAttribute('y1', padTop);
        mLine.setAttribute('x2', splitX);
        mLine.setAttribute('y2', height - padBottom);
        mLine.setAttribute('stroke', 'rgba(0, 229, 255, 0.5)');
        mLine.setAttribute('stroke-dasharray', '3,3');
        svg.appendChild(mLine);

        const mText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        mText.setAttribute('x', splitX);
        mText.setAttribute('y', padTop - 5);
        mText.setAttribute('text-anchor', 'middle');
        mText.setAttribute('fill', '#00e5ff');
        mText.setAttribute('font-size', '10');
        mText.setAttribute('font-weight', '700');
        mText.textContent = 'Heute · Prognose';
        svg.appendChild(mText);
      }
    }

    // Interactive elements: crosshair line & dot
    const crosshair = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    crosshair.setAttribute('stroke', 'rgba(255, 255, 255, 0.4)');
    crosshair.setAttribute('stroke-width', '1');
    crosshair.setAttribute('stroke-dasharray', '3,3');
    crosshair.style.display = 'none';
    svg.appendChild(crosshair);

    const compDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    compDot.setAttribute('r', '5');
    compDot.setAttribute('fill', '#00e676');
    compDot.setAttribute('stroke', '#0c0e0d');
    compDot.setAttribute('stroke-width', '2');
    compDot.style.display = 'none';
    svg.appendChild(compDot);

    const linearDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    linearDot.setAttribute('r', '4');
    linearDot.setAttribute('fill', '#38bdf8');
    linearDot.setAttribute('stroke', '#0c0e0d');
    linearDot.setAttribute('stroke-width', '2');
    linearDot.style.display = 'none';
    svg.appendChild(linearDot);

    container.appendChild(svg);

    // Floating Tooltip
    let tooltip = container.querySelector('.sonic-chart-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'sonic-chart-tooltip';
      container.style.position = 'relative';
      container.appendChild(tooltip);
    }
    tooltip.style.display = 'none';

    // Mouse & Touch events
    function onMove(evt) {
      const rect = svg.getBoundingClientRect();
      const clientX = evt.clientX || (evt.touches && evt.touches[0].clientX);
      if (!clientX) return;

      const relX = clientX - rect.left;
      if (relX < padLeft || relX > width - padRight) {
        onLeave();
        return;
      }

      const ratio = (relX - padLeft) / plotW;
      const idx = Math.min(timeline.length - 1, Math.max(0, Math.round(ratio * (timeline.length - 1))));
      const pt = timeline[idx];

      const x = getX(idx);
      const compY = getY(options.mode === 'cash' ? pt.compBalance : pt.gainPct);
      const linearY = getY(options.mode === 'cash' ? pt.linearBalance : pt.linearGainPct);

      crosshair.setAttribute('x1', x);
      crosshair.setAttribute('y1', padTop);
      crosshair.setAttribute('x2', x);
      crosshair.setAttribute('y2', height - padBottom);
      crosshair.style.display = 'block';

      compDot.setAttribute('cx', x);
      compDot.setAttribute('cy', compY);
      compDot.style.display = 'block';

      linearDot.setAttribute('cx', x);
      linearDot.setAttribute('cy', linearY);
      linearDot.style.display = 'block';

      // Tooltip content
      const diffCash = pt.compBalance - pt.linearBalance;
      const diffSign = diffCash >= 0 ? '+' : '';
      const forecastTag = pt.isForecast 
        ? ' <span style="background:rgba(0,229,255,0.18); color:#00e5ff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:6px; border:1px solid rgba(0,229,255,0.35); text-transform:uppercase; letter-spacing:0.5px;">Prognose</span>' 
        : '';

      tooltip.innerHTML = `
        <div class="tt-date" style="display:flex; align-items:center; justify-content:space-between;">
          <span>${formatFullDate(pt.date)}</span>
          ${forecastTag}
        </div>
        <div class="tt-row comp">
          <span class="tt-bullet" style="background:${pt.isForecast ? '#00e5ff' : '#00e676'};"></span>
          <span>Reinvestiert:</span>
          <strong>$${pt.compBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (+${pt.gainPct.toFixed(1)}%)</strong>
        </div>
        <div class="tt-row linear">
          <span class="tt-bullet"></span>
          <span>Ohne Reinvest:</span>
          <span>$${pt.linearBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (+${pt.linearGainPct.toFixed(1)}%)</span>
        </div>
        ${diffCash !== 0 ? `
          <div class="tt-diff">
            Zinseszins-Vorteil: <strong>${diffSign}$${Math.round(diffCash).toLocaleString()}</strong>
          </div>
        ` : ''}
      `;

      tooltip.style.display = 'block';
      let ttLeft = x + 15;
      if (ttLeft + 200 > width) ttLeft = x - 215;
      tooltip.style.left = `${ttLeft}px`;
      tooltip.style.top = `${Math.min(compY, linearY) + 10}px`;
    }

    function onLeave() {
      crosshair.style.display = 'none';
      compDot.style.display = 'none';
      linearDot.style.display = 'none';
      tooltip.style.display = 'none';
    }

    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', onLeave);
    svg.addEventListener('touchmove', onMove, { passive: true });
    svg.addEventListener('touchend', onLeave);
  }

  function formatDateLabel(iso) {
    if (!iso) return '';
    const parts = iso.split('-');
    const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const m = parseInt(parts[1], 10) - 1;
    return `${parts[2]}. ${months[m] || ''} '${parts[0].slice(2)}`;
  }

  function formatFullDate(iso) {
    if (!iso) return '';
    const parts = iso.split('-');
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const m = parseInt(parts[1], 10) - 1;
    return `${parseInt(parts[2], 10)}. ${months[m] || ''} ${parts[0]}`;
  }

  function renderStreaksChart(container, data) {
    if (!container) return;
    container.innerHTML = '';

    const lossDist = Array.isArray(data && data.losing_distribution) ? data.losing_distribution : [];
    const winDist = Array.isArray(data && data.winning_distribution) ? data.winning_distribution : [];

    const bars = [];
    for (let i = lossDist.length - 1; i >= 0; i--) {
      bars.push({
        type: 'loss',
        length: i + 1,
        count: lossDist[i] || 0
      });
    }
    for (let i = 0; i < winDist.length; i++) {
      bars.push({
        type: 'win',
        length: i + 1,
        count: winDist[i] || 0
      });
    }

    if (bars.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding: 48px 16px; color: rgba(255,255,255,0.45);">Keine Streak-Daten verfügbar</div>';
      return;
    }

    const ns = 'http://www.w3.org/2000/svg';
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width || container.clientWidth || 720, 420);
    const height = 300;
    const padLeft = 48;
    const padRight = 20;
    const padTop = 36;
    const padBottom = 46;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxCount = Math.max(...bars.map(b => b.count), 1);
    const yStep = maxCount <= 10 ? 2 : maxCount <= 25 ? 5 : maxCount <= 60 ? 10 : 20;
    const yMax = Math.ceil(maxCount / yStep) * yStep;

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Balkendiagramm der Verlustserien (${lossDist.length} bis 1) und Gewinnserien (1 bis ${winDist.length})`);

    const titleEl = document.createElementNS(ns, 'title');
    titleEl.textContent = `Gewinn- und Verlustserien: Längste Gewinnserie ${data.longest_winning_streak || 0}, längste Verlustserie ${data.longest_losing_streak || 0}`;
    svg.appendChild(titleEl);

    // Horizontal grid & Y-axis (Occurrence)
    for (let v = 0; v <= yMax; v += yStep) {
      const y = padTop + plotH - (v / yMax) * plotH;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', padLeft);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - padRight);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', v === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', padLeft - 8);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', 'rgba(255,255,255,0.55)');
      label.setAttribute('font-size', '11');
      label.textContent = String(v);
      svg.appendChild(label);
    }

    // Y-axis header
    const yCaption = document.createElementNS(ns, 'text');
    yCaption.setAttribute('x', padLeft);
    yCaption.setAttribute('y', 16);
    yCaption.setAttribute('fill', 'rgba(255,255,255,0.5)');
    yCaption.setAttribute('font-size', '11');
    yCaption.textContent = 'Häufigkeit';
    svg.appendChild(yCaption);

    const n = bars.length;
    const slotW = plotW / n;
    const barW = Math.max(8, Math.min(34, slotW * 0.72));

    // Group labels + divider between losing and winning streaks
    if (lossDist.length > 0 && winDist.length > 0) {
      const divX = padLeft + lossDist.length * slotW;
      const divider = document.createElementNS(ns, 'line');
      divider.setAttribute('x1', divX);
      divider.setAttribute('y1', padTop - 8);
      divider.setAttribute('x2', divX);
      divider.setAttribute('y2', padTop + plotH + 18);
      divider.setAttribute('stroke', 'rgba(255,255,255,0.22)');
      divider.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(divider);

      const lossHdr = document.createElementNS(ns, 'text');
      lossHdr.setAttribute('x', Math.max(padLeft + 4, divX - 10));
      lossHdr.setAttribute('y', 16);
      lossHdr.setAttribute('text-anchor', 'end');
      lossHdr.setAttribute('fill', '#ff5252');
      lossHdr.setAttribute('font-size', '11');
      lossHdr.setAttribute('font-weight', '600');
      lossHdr.textContent = 'Verlustserien';
      svg.appendChild(lossHdr);

      const winHdr = document.createElementNS(ns, 'text');
      winHdr.setAttribute('x', divX + 10);
      winHdr.setAttribute('y', 16);
      winHdr.setAttribute('text-anchor', 'start');
      winHdr.setAttribute('fill', '#00e676');
      winHdr.setAttribute('font-size', '11');
      winHdr.setAttribute('font-weight', '600');
      winHdr.textContent = 'Gewinnserien';
      svg.appendChild(winHdr);
    }

    let tooltip = container.querySelector('.streak-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'streak-tooltip';
      container.appendChild(tooltip);
    }
    tooltip.style.display = 'none';

    bars.forEach((b, idx) => {
      const cx = padLeft + (idx + 0.5) * slotW;
      const barH = b.count > 0 ? Math.max(3, (b.count / yMax) * plotH) : 0;
      const x = cx - barW / 2;
      const y = padTop + plotH - barH;
      const fill = b.type === 'loss' ? '#ff5252' : '#00e676';

      const barRect = document.createElementNS(ns, 'rect');
      barRect.setAttribute('x', x.toFixed(1));
      barRect.setAttribute('y', y.toFixed(1));
      barRect.setAttribute('width', barW.toFixed(1));
      barRect.setAttribute('height', barH.toFixed(1));
      barRect.setAttribute('rx', '3');
      barRect.setAttribute('fill', fill);
      barRect.setAttribute('fill-opacity', b.count > 0 ? '0.85' : '0.15');
      barRect.style.cursor = 'pointer';

      barRect.addEventListener('mouseenter', () => {
        barRect.setAttribute('fill-opacity', '1');
        const kindLabel = b.type === 'loss' ? 'Verlustserie' : 'Gewinnserie';
        tooltip.innerHTML = `<strong>${b.length}er ${kindLabel}</strong><br>${b.count}× aufgetreten`;
        tooltip.style.display = 'block';
        const left = Math.min(Math.max(8, cx - 55), width - 140);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(6, y - 48)}px`;
      });
      barRect.addEventListener('mouseleave', () => {
        barRect.setAttribute('fill-opacity', b.count > 0 ? '0.85' : '0.15');
        tooltip.style.display = 'none';
      });
      svg.appendChild(barRect);

      if (b.count > 0) {
        const valText = document.createElementNS(ns, 'text');
        valText.setAttribute('x', cx.toFixed(1));
        valText.setAttribute('y', Math.max(padTop + 10, y - 5).toFixed(1));
        valText.setAttribute('text-anchor', 'middle');
        valText.setAttribute('fill', 'rgba(255,255,255,0.8)');
        valText.setAttribute('font-size', '10');
        valText.textContent = String(b.count);
        svg.appendChild(valText);
      }

      const xText = document.createElementNS(ns, 'text');
      xText.setAttribute('x', cx.toFixed(1));
      xText.setAttribute('y', height - padBottom + 16);
      xText.setAttribute('text-anchor', 'middle');
      xText.setAttribute('fill', b.type === 'loss' ? '#ff8a80' : '#69f0ae');
      xText.setAttribute('font-size', '11');
      xText.setAttribute('font-weight', '600');
      xText.textContent = String(b.length);
      svg.appendChild(xText);
    });

    const xCaption = document.createElementNS(ns, 'text');
    xCaption.setAttribute('x', padLeft + plotW / 2);
    xCaption.setAttribute('y', height - 8);
    xCaption.setAttribute('text-anchor', 'middle');
    xCaption.setAttribute('fill', 'rgba(255,255,255,0.5)');
    xCaption.setAttribute('font-size', '11');
    xCaption.textContent = 'Serienlänge (Trades in Folge)';
    svg.appendChild(xCaption);

    container.appendChild(svg);
  }

  const Chart = {
    render: renderChart,
    renderStreaks: renderStreaksChart
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Chart;
  } else {
    root.SonicChart = Chart;
  }
})(typeof window !== 'undefined' ? window : globalThis);
