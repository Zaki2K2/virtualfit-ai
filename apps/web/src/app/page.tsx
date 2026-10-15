import Link from 'next/link';
import {
  ArrowRight,
  Camera,
  Clock,
  Cpu,
  Heart,
  Layers,
  Shirt,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const STEPS = [
  {
    icon: Upload,
    title: 'Upload your photo',
    text: 'Add a clear, front-facing picture of yourself. JPEG or PNG.',
  },
  {
    icon: Shirt,
    title: 'Choose a garment',
    text: 'Pick from the wardrobe or upload an image of any garment.',
  },
  {
    icon: Wand2,
    title: 'Generate the try-on',
    text: 'An AI model renders the garment onto your photo.',
  },
  {
    icon: Heart,
    title: 'Compare & save',
    text: 'Slide between before and after, then download or favorite it.',
  },
];

const CATEGORIES = [
  { label: 'Shirts & T-shirts', image: '/samples/shirt-oxford-blue.png' },
  { label: 'Jackets', image: '/samples/jacket-denim.png' },
  { label: 'Trousers', image: '/samples/trousers-chino-khaki.png' },
  { label: 'Dresses', image: '/samples/dress-midi-indigo.png' },
];

const BENEFITS = [
  {
    icon: Clock,
    title: 'Decide faster',
    text: 'Preview several looks in minutes instead of trying clothes on one by one.',
  },
  {
    icon: Layers,
    title: 'Compare side by side',
    text: 'A before-and-after slider makes it easy to judge a look.',
  },
  {
    icon: Heart,
    title: 'Keep your favorites',
    text: 'Save outfits you like and come back to them later.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy-minded',
    text: 'Photos are processed in memory, metadata is stripped, and results expire automatically.',
  },
];

const FAQ = [
  {
    q: 'Does it tell me which size to buy?',
    a: 'No. VirtualFit AI shows how a garment may look on you. It does not measure or predict physical fit, and height and weight alone cannot determine fit. Size recommendations are not part of this version.',
  },
  {
    q: 'Where does my photo go?',
    a: 'Photos are validated and processed in memory. Only the generated result is stored, and it is deleted after a retention period unless you save it. If a real AI provider is used, your photo is sent to that external service, and you are asked for consent first.',
  },
  {
    q: 'Is the AI real right now?',
    a: 'Out of the box the app runs a clearly labelled simulation that does not use AI, so it works without a GPU. Real generation needs a configured Hugging Face Space; the Settings page shows which mode is active.',
  },
  {
    q: 'Which photos work best?',
    a: 'A single person, facing the camera, well lit, with a plain background and arms slightly away from the body. Garment images work best as a single item on a plain background.',
  },
  {
    q: 'Can I use it commercially?',
    a: 'No. This is a noncommercial university project, and the research models it targets (such as CatVTON) are licensed for noncommercial use.',
  },
  {
    q: 'Will there be live camera try-on?',
    a: 'It is on the roadmap. This first version focuses on photo-based try-on.',
  },
];

export default function LandingPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
              <Sparkles className="size-3.5" /> AI-powered virtual dressing room
            </span>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              See how clothes look on you before you wear them.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Upload a photo, choose a shirt, jacket, trousers or dress, and preview the result.
              Compare it with your original and save the looks you love.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/try-on">
                  Try Clothes Virtually <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#how-it-works">How it works</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              No account needed. A university research project - noncommercial.
            </p>
          </div>

          <div
            className="relative mx-auto grid w-full max-w-md grid-cols-2 gap-3"
            aria-hidden="true"
          >
            {[
              '/samples/tee-classic-white.png',
              '/samples/jacket-denim.png',
              '/samples/dress-midi-indigo.png',
              '/samples/trousers-chino-khaki.png',
            ].map((src, i) => (
              <div
                key={src}
                className={`overflow-hidden rounded-xl border border-border bg-surface shadow-card ${i % 2 === 1 ? 'mt-8' : ''}`}
              >
                <img src={src} alt="" className="aspect-square w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Four steps from photo to preview.</p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-lg border border-border bg-surface p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
                  <Icon className="size-5" />
                </span>
                <span className="text-sm font-medium text-muted-foreground">0{i + 1}</span>
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Supported clothing
              </h2>
              <p className="mt-2 text-muted-foreground">
                Try tops, outerwear, bottoms and dresses.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/wardrobe">Browse the wardrobe</Link>
            </Button>
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {CATEGORIES.map((c) => (
              <li key={c.label}>
                <Link href="/wardrobe" className="group block space-y-2">
                  <div className="overflow-hidden rounded-lg border border-border bg-muted">
                    <img
                      src={c.image}
                      alt=""
                      className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </div>
                  <p className="font-medium">{c.label}</p>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Sample catalog items are simple illustrations, not real products.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Why VirtualFit AI</h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="space-y-2">
              <Icon className="size-6 text-accent" />
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <span className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-accent">
              <Cpu className="size-4" /> The technology
            </span>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How the AI works</h2>
          </div>
          <div className="space-y-4 text-muted-foreground">
            <p>
              Virtual try-on models such as CatVTON and IDM-VTON are diffusion-based research
              models. Given a photo of a person and a photo of a garment, they repaint the relevant
              area of the person so the garment appears to be worn, while keeping the face, pose and
              background.
            </p>
            <p>
              These models need a powerful GPU, so VirtualFit AI sends the request to a remotely
              hosted model (for example a Hugging Face Space) instead of running it on your
              computer.
            </p>
            <p className="flex gap-2 rounded-md bg-warning-soft p-3 text-sm text-warning">
              <Camera className="mt-0.5 size-4 shrink-0" />
              <span>
                The result is a visual preview. It can contain artifacts and says nothing about
                real-world size or fit.
              </span>
            </p>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Frequently asked questions
        </h2>
        <div className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
          {FAQ.map((item) => (
            <details key={item.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center justify-between gap-4 font-medium">
                {item.q}
                <span
                  aria-hidden="true"
                  className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="flex flex-col items-center gap-4 rounded-xl bg-primary px-6 py-12 text-center text-primary-foreground">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ready to try it on?</h2>
          <p className="max-w-lg text-primary-foreground/75">
            It takes less than a minute. No account needed.
          </p>
          <Button asChild size="lg" variant="accent">
            <Link href="/try-on">
              Try Clothes Virtually <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
