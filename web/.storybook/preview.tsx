import type { Preview } from '@storybook/react-vite'
import '../src/index.css'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { BrowserRouter } from 'react-router-dom'

const preview: Preview = {
  decorators: [
    (Story) => (
      <BrowserRouter>
        <TooltipProvider>
          <div className="min-h-[200px] p-4">
            <Story />
          </div>
        </TooltipProvider>
      </BrowserRouter>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
    layout: 'padded',
  },
};

export default preview;
