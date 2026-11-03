// Turns a finished k6 load run into plain language for people who don't read p95s: a verdict,
// three ratings (speed, reliability, capacity), what we noticed, what to do next and a glossary.
// Pure functions, used by the load test page and by the downloadable HTML report.

const fmtMs = (ms) => (ms == null ? '–' : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} seconds` : `${Math.round(ms)} ms`);
const fmtDuration = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s} second${s === 1 ? '' : 's'}`;
  return `${m} minute${m === 1 ? '' : 's'}${s ? ` ${s} second${s === 1 ? '' : 's'}` : ''}`;
};
const num = (n) => Math.round(n).toLocaleString('en-US');
const people = (n) => `${num(n)} ${n === 1 ? 'person' : 'people'}`;
const pct = (n) => `${Number(n.toFixed(2))}%`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// General web guidance, used when the test has no limit of its own. Times are for 95 out of 100
// requests: under half a second feels instant, over three seconds people start to leave.
function rateSpeed(p95, limit) {
  if (limit != null) {
    if (p95 >= limit) return { level: 'bad', label: 'Slower than target' };
    return p95 <= limit * 0.6 ? { level: 'good', label: 'Well within target' } : { level: 'good', label: 'Within target' };
  }
  if (p95 <= 500) return { level: 'good', label: 'Fast' };
  if (p95 <= 1000) return { level: 'good', label: 'Good' };
  if (p95 <= 3000) return { level: 'warn', label: 'Noticeably slow' };
  return { level: 'bad', label: 'Too slow' };
}

function rateReliability(errorPct, limit) {
  if (limit != null && errorPct > limit) return { level: 'bad', label: 'More errors than allowed' };
  if (errorPct === 0) return { level: 'good', label: 'No errors' };
  if (errorPct < 1) return { level: 'good', label: 'Reliable' };
  if (errorPct < 5) return { level: limit != null ? 'good' : 'warn', label: limit != null ? 'Within target' : 'Some errors' };
  return { level: 'bad', label: 'Unreliable' };
}

// How response times changed as users were added, from the live samples taken every few seconds.
function loadBehaviour(samples, peakVus) {
  const points = samples.filter((p) => p.avgMs != null && p.vus > 0);
  if (points.length < 4 || !peakVus) return null;
  const light = points.filter((p) => p.vus <= Math.max(1, peakVus * 0.3));
  const full = points.filter((p) => p.vus >= peakVus * 0.95);
  const baseline = avg(light.map((p) => p.avgMs)) ?? points[0].avgMs;
  const fullAvg = avg(full.map((p) => p.avgMs));
  if (!baseline || fullAvg == null) return null;

  // The first moment things got clearly worse: twice as slow as with few users, or 5% errors.
  const strain = points.find((p) => (p.avgMs > Math.max(baseline * 2, baseline + 200) || (p.errorPct ?? 0) >= 5) && p.vus > 1);

  // Did it keep getting slower while the load stayed the same?
  const half = Math.floor(full.length / 2);
  const firstHalf = avg(full.slice(0, half).map((p) => p.avgMs));
  const secondHalf = avg(full.slice(half).map((p) => p.avgMs));
  const creeping = full.length >= 6 && firstHalf && secondHalf > firstHalf * 1.5 && secondHalf - firstHalf > 100;

  return {
    baselineMs: baseline,
    fullMs: fullAvg,
    ratio: fullAvg / baseline,
    strainAtVus: strain?.vus ?? null,
    strainAtSec: strain?.t ?? null,
    creeping,
    hasLightPhase: light.length > 0 && full.length > 0,
  };
}

const VERDICT_TEXT = {
  good: 'Performed well under load',
  warn: 'Works under load, with room to improve',
  bad: 'Struggled under load',
};

export function buildLoadReport(test, run) {
  const s = run?.summary;
  if (!s) return null;
  const c = run.config;
  const scenario = c.kind === 'scenario';
  const peak = s.maxVus ?? c.vus;
  const durationSec = Math.max(1, Math.round(s.durationMs / 1000));
  const target = scenario ? `the "${test.name}" journey (${c.steps?.length ?? s.steps.length} steps)` : `${c.method} ${c.url}`;
  const successPct = Math.max(0, 100 - s.errorPct);

  const speed = rateSpeed(s.p95Ms, c.maxP95Ms);
  const reliability = rateReliability(s.errorPct, c.maxErrorRatePct);
  const behaviour = loadBehaviour(run.samples ?? [], peak);
  const stability =
    !behaviour || !behaviour.hasLightPhase
      ? null
      : behaviour.ratio < 1.5 && !behaviour.creeping
        ? { level: 'good', label: 'Steady' }
        : behaviour.ratio < 3
          ? { level: 'warn', label: 'Slowed down' }
          : { level: 'bad', label: 'Slowed down a lot' };

  const worstOf = (ratings) => ratings.filter(Boolean).reduce((w, r) => (r.level === 'bad' ? 'bad' : r.level === 'warn' && w !== 'bad' ? 'warn' : w), 'good');
  const worst = worstOf([speed, reliability, stability]);
  // Capacity has no pass/fail of its own: it follows whether the site held up as users were added
  // (errors, and slowing down compared with light load). Without a light phase, speed stands in.
  const strain = worstOf([reliability, stability ?? speed]);
  const capacity = { level: strain, label: strain === 'bad' ? 'Over its limit' : strain === 'warn' ? 'Near its limit' : 'Coped comfortably' };

  // ---- Verdict ----
  const crossed = (s.thresholds ?? []).filter((t) => !t.ok);
  const hasLimits = c.maxP95Ms != null || c.maxErrorRatePct != null || (c.steps ?? []).some((st) => st.maxP95Ms != null);
  let verdict;
  if (run.status === 'ERROR') {
    verdict = { level: 'bad', title: 'The test could not finish', detail: run.error ?? 'The load generator stopped with an error. The numbers below cover only the part that ran.' };
  } else if (run.status === 'CANCELLED') {
    verdict = { level: 'warn', title: 'The test was stopped early', detail: 'Someone stopped the run before the end, so these results only cover part of the planned load.' };
  } else if (run.status === 'FAILED' || crossed.length > 0) {
    verdict = { level: 'bad', title: 'Did not meet the agreed targets', detail: `${crossed.length || 'Some'} of the targets set for this test ${crossed.length === 1 ? 'was' : 'were'} missed. Details are below.` };
  } else if (hasLimits) {
    verdict = { level: worst === 'bad' ? 'warn' : 'good', title: 'Met all agreed targets', detail: 'Every response-time and error target set for this test was met.' };
  } else {
    verdict = { level: worst, title: VERDICT_TEXT[worst], detail: 'No targets were set for this test, so it was judged against common web guidance (see "How we rate" below).' };
  }

  const summaryLine =
    `We simulated ${people(peak)} using ${target} at the same time for ${fmtDuration(durationSec)}. ` +
    `95 out of every 100 ${scenario ? 'requests' : 'responses'} came back within ${fmtMs(s.p95Ms)}, ` +
    `and ${pct(Math.round(successPct * 100) / 100)} of all ${num(s.requests)} requests succeeded.`;

  // ---- The three ratings ----
  const perMinute = s.rps * 60 >= 1000 ? Math.round((s.rps * 60) / 100) * 100 : s.rps * 60;
  const cards = [
    {
      key: 'speed',
      title: 'Speed',
      question: 'How quickly did it respond?',
      ...speed,
      value: fmtMs(s.p95Ms),
      headline: `95 out of 100 requests were answered within ${fmtMs(s.p95Ms)}.`,
      detail:
        `The typical (median) response took ${fmtMs(s.medMs)}; the single slowest took ${fmtMs(s.maxMs)}.` +
        (c.maxP95Ms != null ? ` The target was under ${fmtMs(c.maxP95Ms)}.` : ''),
    },
    {
      key: 'reliability',
      title: 'Reliability',
      question: 'Did requests succeed?',
      ...reliability,
      value: pct(Math.round(successPct * 100) / 100),
      headline:
        s.failedRequests === 0
          ? `Every one of the ${num(s.requests)} requests succeeded.`
          : `${num(s.failedRequests)} of ${num(s.requests)} requests failed (${pct(s.errorPct)}).`,
      detail:
        s.failedRequests === 0
          ? 'No errors, time-outs or rejected requests were seen.'
          : `A failed request is one that returned an error, timed out${scenario ? ', or did not return what the step expected' : ''}. A real visitor would have seen an error or a broken page.` +
            (c.maxErrorRatePct != null ? ` The target was at most ${pct(c.maxErrorRatePct)}.` : ''),
    },
    {
      key: 'capacity',
      title: 'Capacity',
      question: 'How much traffic did it handle?',
      ...capacity,
      value: `${num(s.rps)}/s`,
      headline: `Handled ${people(peak)} at once, about ${num(s.rps)} requests a second (${perMinute >= 1000 ? 'about ' : ''}${num(perMinute)} a minute).`,
      detail: scenario
        ? `${num(s.flows?.completed ?? 0)} complete journeys were finished, each taking about ${fmtMs(s.flows?.avgMs)} of waiting on average.`
        : 'Each simulated person sends a new request as soon as the last one answers, so this is heavier than the same number of real visitors, who pause to read and click.',
    },
  ];

  // ---- What we noticed ----
  const insights = [];
  const add = (level, title, detail = null) => insights.push({ level, title, detail });

  if (behaviour?.hasLightPhase) {
    if (stability.level === 'good') {
      add('good', 'Response times stayed steady as users were added', `About ${fmtMs(behaviour.baselineMs)} with only a few users and ${fmtMs(behaviour.fullMs)} at full load.`);
    } else {
      add(
        stability.level,
        `It got ${behaviour.ratio.toFixed(1)}× slower at full load`,
        `Average response time went from ${fmtMs(behaviour.baselineMs)} with a few users to ${fmtMs(behaviour.fullMs)} with ${people(peak)}. This usually means the server, database or a service it calls is running out of room.`
      );
    }
    if (behaviour.strainAtVus != null && stability.level !== 'good') {
      add('warn', `Strain started at about ${people(behaviour.strainAtVus)}`, `This is roughly where responses first became twice as slow or errors appeared (${fmtDuration(behaviour.strainAtSec)} into the test). Treat it as the comfortable limit today.`);
    }
    if (behaviour.creeping) {
      add('warn', 'It kept getting slower while the load stayed the same', 'Requests were queuing up faster than they were served. Over a longer period this can lead to time-outs.');
    }
  }

  if (s.maxMs > s.p95Ms * 5 && s.maxMs > 2000) {
    add('info', `A few requests were much slower than the rest (up to ${fmtMs(s.maxMs)})`, 'Most people would not notice, but an unlucky few would wait a long time. Occasional spikes like this often come from cold caches, garbage collection or a slow query.');
  }

  if (scenario && s.steps?.length) {
    const slowest = [...s.steps].sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))[0];
    if (slowest && slowest.p95Ms != null && s.steps.length > 1) {
      add(slowest.maxP95Ms != null && slowest.p95Ms >= slowest.maxP95Ms ? 'bad' : 'info', `"${slowest.name}" is the slowest step`, `95 out of 100 of its requests took up to ${fmtMs(slowest.p95Ms)}${slowest.maxP95Ms != null ? ` (target ${fmtMs(slowest.maxP95Ms)})` : ''}. Speeding this step up gives the biggest win.`);
    }
    for (const step of s.steps.filter((st) => (st.failedPct ?? 0) > 0)) {
      add(step.failedPct >= 5 ? 'bad' : 'warn', `"${step.name}" failed ${pct(step.failedPct)} of the time`, 'When a step fails, the simulated person gives up on the rest of that journey.');
    }
  }

  for (const t of crossed) {
    const step = /^step_(\d+)_duration$/.exec(t.metric);
    const stepName = step ? c.steps?.[Number(step[1])]?.name ?? `Step ${Number(step[1]) + 1}` : null;
    if (stepName && insights.some((i) => i.title === `"${stepName}" is the slowest step`)) continue; // already said, with its target
    const limit = Number(/[<>]=?\s*([\d.]+)/.exec(t.rule)?.[1]);
    if (t.metric === 'http_req_failed') {
      add('bad', 'Target missed: too many errors', `The target was fewer than ${pct(limit * 100)} of requests failing; ${pct(s.errorPct)} failed.`);
    } else {
      const actual = stepName ? s.steps?.[Number(step[1])]?.p95Ms : s.p95Ms;
      add('bad', `Target missed: ${stepName ? `"${stepName}" was too slow` : 'responses were too slow'}`, `The target was 95 out of 100 requests within ${fmtMs(limit)}; they took up to ${fmtMs(actual)}.`);
    }
  }

  if (insights.length === 0) add('good', 'Nothing unusual', 'Response times and errors stayed consistent throughout the test.');

  // ---- What to do next ----
  const next = [];
  if (run.status === 'ERROR') next.push('Fix the problem shown above and run the test again before drawing conclusions.');
  if (reliability.level === 'bad' || reliability.level === 'warn') next.push('Look at the server logs for the test window to see what the failed requests ran into.');
  if (speed.level === 'bad' || speed.level === 'warn') next.push(`Find out what makes ${scenario ? 'the slowest step' : 'this request'} slow: heavy database queries, missing caching and slow third-party calls are the usual causes.`);
  if (stability && stability.level !== 'good') next.push(`Run again with fewer users (around ${num(behaviour.strainAtVus ?? Math.max(1, Math.round(peak / 2)))}) to confirm a comfortable capacity, or add server resources and compare.`);
  if (worst === 'good' && run.status === 'PASSED') next.push(`Raise the load above ${people(peak)} to find where the limit actually is, and compare with the traffic you expect at your busiest time.`);
  if (!hasLimits) next.push('Agree response-time and error targets for this test, so each future run gives a clear pass or fail.');

  return {
    test: { name: test.name, project: test.project?.name ?? '', target },
    run: { status: run.status, createdAt: run.createdAt, hostname: run.hostname ?? null },
    load: { users: peak, rampUpSec: c.rampUpSec, fullLoadSec: c.durationSec, durationSec },
    verdict,
    summaryLine,
    cards,
    insights,
    next,
    steps: scenario ? s.steps : null,
    numbers: s,
    glossary: GLOSSARY,
  };
}

export const RATING_GUIDE = [
  ['Speed', 'Under 0.5 s is fast, under 1 s is good, 1–3 s is noticeably slow, over 3 s is too slow (people start leaving). Measured on 95 out of 100 requests.'],
  ['Reliability', 'Under 1% failed is reliable, 1–5% is some errors, over 5% is unreliable.'],
  ['Steadiness', 'Compares response times with a few users to full load: under 1.5× slower is steady, 1.5–3× slowed down, over 3× slowed down a lot.'],
  ['With targets', 'When the test has its own targets, speed and reliability are judged against those instead.'],
];

export const GLOSSARY = [
  ['Virtual user', 'A simulated person, run by the k6 load-testing tool, who keeps using the site for the whole test.'],
  ['Ramp-up', 'The start of the test, when users are added gradually instead of all at once.'],
  ['Request', 'One call to the server, such as loading a page or submitting a form.'],
  ['Requests per second', 'How many requests the server answered each second: its throughput.'],
  ['95th percentile (p95)', '95 out of 100 requests were at least this fast. It shows what nearly everyone experienced, without being skewed by a single outlier.'],
  ['Median', 'The middle value: half of requests were faster, half slower.'],
  ['Failed request', 'A request that returned an error (such as a 500), timed out, or did not return what was expected.'],
];
