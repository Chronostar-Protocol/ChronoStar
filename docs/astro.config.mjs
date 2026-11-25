import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://chronostar-protocol.github.io',
  base: '/ChronoStar',
  integrations: [
    starlight({
      title: 'ChronoStar',
      
      
      description: 'Time-based payment primitives for the Stellar ecosystem.',
      logo: { src: './src/assets/chronostar-logo-lockup.svg' },
      social: { github: 'https://github.com/Chronostar-Protocol/ChronoStar' },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', link: '/getting-started/overview/' },
            { label: 'Quickstart', link: '/getting-started/quickstart/' },
            { label: 'Trustlines & Funding', link: '/getting-started/trustlines-and-funding/' },
          ],
        },
        {
          label: 'Contracts',
          items: [
            { label: 'ScheduleVault', link: '/contracts/schedule-vault/' },
            { label: 'RecurringStream', link: '/contracts/recurring-stream/' },
            { label: 'DCAPolicy', link: '/contracts/dca-policy/' },
            { label: 'Multi-Asset DCA (Design)', link: '/contracts/dca-multi-asset/' },
          ],
        },
        {
          label: 'Operations & Runbooks',
          items: [
            { label: 'Testnet Reset Recovery', link: '/operations/testnet-reset-recovery/' },
          ],
        },
        {
          label: 'Keeper',
          items: [
            { label: 'Self-Hosting', link: '/keeper/self-hosting/' },
          ],
        },
        {
          label: 'API',
          items: [
            { label: 'REST Reference', link: '/api/reference/' },
            { label: 'Wire Format Guide', link: '/api/wire-format/' },
          ],
        },
        {
          label: 'Integration',
          items: [
            { label: 'Lodestar', link: '/integration/lodestar/' },
            { label: 'Executable examples', link: '/integration/executable-examples/' },
          ],
        },
      ],
    }),
  ],
});
