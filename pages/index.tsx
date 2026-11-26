import Head from 'next/head';
import Converter from '../components/Converter';

export default function Home() {
  return (
    <>
      <Head>
        <title>SVG Studio · SVG to GIF</title>
        <meta
          name="description"
          content="Convert animated SVGs to transparent GIFs. Preview, adjust, and download."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Converter />
    </>
  );
}
