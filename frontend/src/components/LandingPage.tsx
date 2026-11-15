import "../landing.css";
import SiteBrand from "./SiteBrand";

const REPOSITORY = "https://github.com/HellFireInfernoStorm/space-monkeys";

/** Decorative star trails, drawn locally; these are not survey observations. */
function SkyArtwork() {
  return <svg className="home-sky-art" viewBox="0 0 1600 1000" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="home-orbit-light" x1="280" y1="800" x2="1260" y2="80" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4058ff" stopOpacity="0" /><stop offset=".35" stopColor="#d29c7e" />
        <stop offset=".7" stopColor="#ffe3b5" /><stop offset="1" stopColor="#d1a175" stopOpacity="0" />
      </linearGradient>
      <filter id="home-orbit-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
    </defs>
    {Array.from({ length: 160 }, (_, i) => {
      const radius = 230 + ((i * 157) % 1230);
      const angle = (172 + ((i * 71) % 112)) * Math.PI / 180;
      const end = angle + (0.008 + (i % 8) * 0.003);
      const x = (a: number) => 1240 + radius * Math.cos(a);
      const y = (a: number) => 1020 + radius * Math.sin(a);
      return <path key={i} d={`M${x(angle)} ${y(angle)} A${radius} ${radius} 0 0 1 ${x(end)} ${y(end)}`}
        stroke={i % 4 ? "#a6b9e9" : "#e0ac9e"} strokeWidth={i % 9 ? .7 : 1.3} opacity={.16 + (i % 5) * .08} />;
    })}
    <path d="M230 1010 A910 910 0 0 1 1490 170" stroke="url(#home-orbit-light)" strokeWidth="10" opacity=".65" filter="url(#home-orbit-glow)" />
    <path d="M230 1010 A910 910 0 0 1 1490 170" stroke="url(#home-orbit-light)" strokeWidth="2" />
    {Array.from({length: 60}, (_, i) => <circle key={i} cx={(i * 239 + 47) % 1600} cy={(i * 163 + 71) % 1000}
      r={i % 7 ? .8 : 1.5} fill="#d9e3fa" opacity={.15 + (i % 4) * .1} />)}
  </svg>;
}

export default function LandingPage() {
  return <div className="home-page">
    <a className="home-skip" href="#home-content">Skip to content</a>
    <section className="home-hero" aria-labelledby="home-title">
      <SkyArtwork />
      <div className="home-planet" aria-hidden="true" />
      <header className="home-header">
        <SiteBrand />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#the-science">The science</a>
          <a href={REPOSITORY} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
        </nav>
        <a className="home-header-cta" href="/explore/">Open workbench <span aria-hidden="true">↗</span></a>
      </header>
      <main id="home-content" className="home-hero-main">
        <div className="home-intro">
          <p className="home-eyebrow">A DIFFERENT WAY TO LOOK AT SPACE</p>
          <h1 id="home-title">SEE THE<br /><span>SKY</span><br />SHIFT.</h1>
          <p className="home-lead">One patch of sky. Many moments in time.<br />Explore the changing infrared universe with SPHEREx.</p>
          <a className="home-text-link" href="#how-it-works">Discover how it works <span aria-hidden="true">↓</span></a>
        </div>
        <div className="home-hero-note"><span className="home-note-line" aria-hidden="true" /><p>Some things only appear<br />when you look again.</p></div>
        <div className="home-launch">
          <span className="home-eyebrow">YOUR NEXT VIEW OF THE UNIVERSE</span>
          <p>Pick a star.<br />Follow its story.</p>
          <a className="home-launch-button" href="/explore/">Explore the sky <span aria-hidden="true">↗</span></a>
          <small>Public demo · Synthetic data, clearly labelled</small>
        </div>
      </main>
      <div className="home-hero-bottom">
        <div><span>01</span><p>Compare images<br /><strong>Blink & difference</strong></p></div>
        <div><span>02</span><p>Reveal faint objects<br /><strong>Motion-tracked stacking</strong></p></div>
        <div><span>03</span><p>Read the light<br /><strong>Spectrum & light curve</strong></p></div>
        <span className="home-art-label">Illustrated sky · AI-assisted, not survey data</span>
      </div>
    </section>

    <section id="how-it-works" className="home-section home-how" aria-labelledby="home-how-title">
      <div className="home-section-heading"><p className="home-eyebrow">01 / GET YOUR BEARINGS</p><h2 id="home-how-title">One patch of sky,<br />many nights.</h2>
        <p>You don’t need to be an astronomer to start. Choose a target, compare its observations, and see what catches your eye.</p></div>
      <ol className="home-steps">
        <li><span>01 — CHOOSE</span><h3>Start somewhere.</h3><p>Pick a featured target, or enter a sky position using right ascension and declination—the sky’s coordinates.</p></li>
        <li><span>02 — MATCH</span><h3>Compare similar light.</h3><p>Each exposure can see an object at a different infrared wavelength. Narrow the range so colour is less likely to look like change.</p></li>
        <li><span>03 — PLAY</span><h3>Watch time unfold.</h3><p>Play images in date order, step through one at a time, or use difference mode to see what differs from the first exposure.</p></li>
      </ol>
    </section>

    <section id="the-science" className="home-section home-science" aria-labelledby="home-science-title">
      <div className="home-science-copy"><p className="home-eyebrow">02 / LOOK A LITTLE DEEPER</p><h2 id="home-science-title">Faint doesn’t mean<br />out of reach.</h2>
        <p>WISE 0855 is a cold, faint brown dwarf. A single exposure is hard to distinguish from noise. Aligning many exposures along its predicted path makes it easier to see.</p>
        <p>In our local research check, both a tracked stack and a fixed-sky stack detected it. Tracking made the signal clearer.</p>
        <a className="home-text-link" href="/explore/?mode=stack">Try stacking in the workbench <span aria-hidden="true">↗</span></a>
      </div>
      <div className="home-research" aria-label="WISE 0855 local research results">
        <div className="home-research-heading"><span>WISE 0855</span><span>LOCAL RESEARCH CHECK</span></div>
        <p className="home-research-range">46 exposures <span> / </span> 4.4–5.0 µm</p>
        <div className="home-signal-row"><span>Motion-tracked</span><div className="home-signal-track"><span style={{width:"100%"}} /></div><strong>14.2 <small>S/N</small></strong></div>
        <div className="home-signal-row"><span>Fixed sky grid</span><div className="home-signal-track"><span style={{width:`${11.44 / 14.18 * 100}%`}} /></div><strong>11.4 <small>S/N</small></strong></div>
        <p className="home-research-foot">Signal-to-noise (S/N): higher means a clearer signal. Both stacks use the same exposures. These are local research results, not live demo measurements.</p>
        <a href={`${REPOSITORY}/blob/main/docs/SCIENCE.md`} target="_blank" rel="noreferrer">Read the method and limits <span aria-hidden="true">↗</span></a>
      </div>
    </section>

    <section className="home-section home-more" aria-labelledby="home-more-title">
      <div><p className="home-eyebrow">03 / KEEP EXPLORING</p><h2 id="home-more-title">There’s more in the light.</h2></div>
      <div className="home-more-item"><span>ACROSS WAVELENGTHS & TIME</span><h3>A spectrum. A light curve.</h3><p>Click a point to explore brightness across wavelengths and observations. These are quick estimates; nearby stars and measurement limits can affect the result.</p></div>
      <div className="home-more-item"><span>THEN & NOW</span><h3>The same field, years apart.</h3><p>Compare AllWISE observations from 2010 with SPHEREx views from 2025–26. Differences in sharpness and wavelength matter, too.</p></div>
    </section>
    <section className="home-final"><p className="home-eyebrow">BUILT FOR THE CURIOUS</p><h2>The sky is waiting.</h2><a className="home-launch-button" href="/explore/">Open SpaceShift <span aria-hidden="true">↗</span></a><p>Copy your workbench URL to share a position and its settings.</p></section>
    <footer className="home-footer"><SiteBrand /><p>Built by space-monkeys · Planet X and SPHEREx</p><div><a href={REPOSITORY} target="_blank" rel="noreferrer">Source & credits ↗</a><span>AI-assisted code & illustration · No NASA affiliation or endorsement</span></div></footer>
  </div>;
}
