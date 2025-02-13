import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import { Router } from 'react-router-dom';
import { useEffectOnce } from 'react-use';
import { AutoSizerProps } from 'react-virtualized-auto-sizer';
import { getGrafanaContextMock } from 'test/mocks/getGrafanaContextMock';

import { selectors as e2eSelectors } from '@grafana/e2e-selectors/src';
import { locationService } from '@grafana/runtime';
import { Dashboard, DashboardCursorSync, FieldConfigSource, ThresholdsMode, Panel } from '@grafana/schema/src';
import config from 'app/core/config';
import { GrafanaContext } from 'app/core/context/GrafanaContext';
import { getRouteComponentProps } from 'app/core/navigation/__mocks__/routeProps';
import * as appTypes from 'app/types';
import { DashboardInitPhase, DashboardMeta, DashboardRoutes } from 'app/types';

import { SafeDynamicImport } from '../../../core/components/DynamicImports/SafeDynamicImport';
import { configureStore } from '../../../store/configureStore';
import { Props as LazyLoaderProps } from '../dashgrid/LazyLoader';
import { DashboardModel } from '../state';
import { initDashboard } from '../state/initDashboard';

import PublicDashboardPage, { Props } from './PublicDashboardPage';

jest.mock('app/features/dashboard/dashgrid/LazyLoader', () => {
  const LazyLoader = ({ children, onLoad }: Pick<LazyLoaderProps, 'children' | 'onLoad'>) => {
    useEffectOnce(() => {
      onLoad?.();
    });
    return <>{typeof children === 'function' ? children({ isInView: true }) : children}</>;
  };
  return { LazyLoader };
});

jest.mock('react-virtualized-auto-sizer', () => {
  //   //   // The size of the children need to be small enough to be outside the view.
  //   //   // So it does not trigger the query to be run by the PanelQueryRunner.
  return ({ children }: AutoSizerProps) => children({ height: 1, width: 1 });
});

jest.mock('app/features/dashboard/state/initDashboard', () => ({
  ...jest.requireActual('app/features/dashboard/state/initDashboard'),
  initDashboard: jest.fn(),
}));

jest.mock('app/types', () => ({
  ...jest.requireActual('app/types'),
  useDispatch: () => jest.fn(),
}));

const setup = (propOverrides?: Partial<Props>, initialState?: Partial<appTypes.StoreState>) => {
  const context = getGrafanaContextMock();
  const store = configureStore(initialState);

  const props: Props = {
    ...getRouteComponentProps({
      match: { params: { accessToken: 'an-access-token' }, isExact: true, url: '', path: '' },
      route: {
        routeName: DashboardRoutes.Public,
        path: '/public-dashboards/:accessToken',
        component: SafeDynamicImport(
          () =>
            import(/* webpackChunkName: "PublicDashboardPage"*/ 'app/features/dashboard/containers/PublicDashboardPage')
        ),
      },
    }),
  };

  Object.assign(props, propOverrides);

  const { unmount, rerender } = render(
    <GrafanaContext.Provider value={context}>
      <Provider store={store}>
        <Router history={locationService.getHistory()}>
          <PublicDashboardPage {...props} />
        </Router>
      </Provider>
    </GrafanaContext.Provider>
  );

  const wrappedRerender = (newProps: Partial<Props>) => {
    Object.assign(props, newProps);
    return rerender(
      <GrafanaContext.Provider value={context}>
        <Provider store={store}>
          <Router history={locationService.getHistory()}>
            <PublicDashboardPage {...props} />
          </Router>
        </Provider>
      </GrafanaContext.Provider>
    );
  };

  return { rerender: wrappedRerender, unmount };
};

const selectors = e2eSelectors.components;
const publicDashboardSelector = e2eSelectors.pages.PublicDashboard;

const getTestDashboard = (overrides?: Partial<Dashboard>, metaOverrides?: Partial<DashboardMeta>): DashboardModel => {
  const data: Dashboard = Object.assign(
    {
      title: 'My dashboard',
      revision: 1,
      editable: false,
      graphTooltip: DashboardCursorSync.Off,
      schemaVersion: 1,
      timepicker: { hidden: true },
      timezone: '',
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'My panel title',
          gridPos: { x: 0, y: 0, w: 1, h: 1 },
        },
      ],
    },
    overrides
  );

  return new DashboardModel(data, metaOverrides);
};

describe('PublicDashboardPage', () => {
  beforeEach(() => {
    config.featureToggles.publicDashboards = true;
    config.featureToggles.newPanelChromeUI = true;

    jest.clearAllMocks();
  });

  it('Should call initDashboard on mount', () => {
    setup();
    expect(initDashboard).toBeCalledWith({
      fixUrl: false,
      accessToken: 'an-access-token',
      routeName: 'public-dashboard',
      keybindingSrv: expect.anything(),
    });
  });

  describe('Given a simple public dashboard', () => {
    const newState = {
      dashboard: {
        getModel: getTestDashboard,
        initError: null,
        initPhase: DashboardInitPhase.Completed,
        permissions: [],
      },
    };

    it('Should render panels', async () => {
      setup(undefined, newState);
      expect(await screen.findByText('My panel title')).toBeInTheDocument();
    });

    it('Should update title', async () => {
      setup(undefined, newState);
      await waitFor(() => {
        expect(document.title).toBe('My dashboard - Grafana');
      });
    });

    it('Should not render neither time range nor refresh picker buttons', async () => {
      setup(undefined, newState);
      await waitFor(() => {
        expect(screen.queryByTestId(selectors.TimePicker.openButton)).not.toBeInTheDocument();
        expect(screen.queryByTestId(selectors.RefreshPicker.runButtonV2)).not.toBeInTheDocument();
        expect(screen.queryByTestId(selectors.RefreshPicker.intervalButtonV2)).not.toBeInTheDocument();
      });
    });

    it('Should not render paused or deleted screen', async () => {
      setup(undefined, newState);
      await waitFor(() => {
        expect(screen.queryByTestId(publicDashboardSelector.NotAvailable.container)).not.toBeInTheDocument();
      });
    });

    it('Should render panel with hover widget but without drag icon when panel title is undefined', async () => {
      const fieldConfig: FieldConfigSource = {
        defaults: {
          thresholds: {
            mode: ThresholdsMode.Absolute,
            steps: [
              {
                color: 'green',
                value: 1,
              },
              {
                color: 'red',
                value: 80,
              },
            ],
          },
        },
        overrides: [],
      };
      const panels: Panel[] = [
        {
          id: 1,
          fieldConfig,
          gridPos: {
            h: 8,
            w: 12,
            x: 0,
            y: 0,
          },
          options: {},
          title: undefined,
          type: 'timeseries',
          repeatDirection: 'h',
          transformations: [],
          transparent: false,
        },
      ];

      const newState = {
        dashboard: {
          getModel: () => getTestDashboard({ panels }),
          initError: null,
          initPhase: DashboardInitPhase.Completed,
          permissions: [],
        },
      };
      setup(undefined, newState);

      await waitFor(() => {
        expect(screen.getByTestId(selectors.Panels.Panel.HoverWidget.container)).toBeInTheDocument();
      });
      await userEvent.hover(screen.getByTestId(selectors.Panels.Panel.HoverWidget.container));
      expect(screen.queryByTestId(selectors.Panels.Panel.HoverWidget.dragIcon)).not.toBeInTheDocument();
    });

    it('Should render panel without hover widget when panel title is not undefined', async () => {
      setup(undefined, newState);
      await waitFor(() => {
        expect(screen.queryByTestId(selectors.Panels.Panel.HoverWidget.container)).not.toBeInTheDocument();
      });
    });
  });

  describe('Given a public dashboard with time range enabled', () => {
    it('Should render time range and refresh picker buttons', async () => {
      setup(undefined, {
        dashboard: {
          getModel: () =>
            getTestDashboard({
              timepicker: { hidden: false, collapse: false, refresh_intervals: [], time_options: [] },
            }),
          initError: null,
          initPhase: DashboardInitPhase.Completed,
          permissions: [],
        },
      });
      expect(await screen.findByTestId(selectors.TimePicker.openButton)).toBeInTheDocument();
      expect(screen.getByTestId(selectors.RefreshPicker.runButtonV2)).toBeInTheDocument();
      expect(screen.getByTestId(selectors.RefreshPicker.intervalButtonV2)).toBeInTheDocument();
    });
  });

  describe('Given paused public dashboard', () => {
    it('Should render public dashboard paused screen', async () => {
      setup(undefined, {
        dashboard: {
          getModel: () => getTestDashboard(undefined, { publicDashboardEnabled: false, dashboardNotFound: false }),
          initError: null,
          initPhase: DashboardInitPhase.Completed,
          permissions: [],
        },
      });

      await waitFor(() => {
        expect(screen.queryByTestId(publicDashboardSelector.page)).not.toBeInTheDocument();
      });
      expect(screen.getByTestId(publicDashboardSelector.NotAvailable.title)).toBeInTheDocument();
      expect(screen.getByTestId(publicDashboardSelector.NotAvailable.pausedDescription)).toBeInTheDocument();
    });
  });

  describe('Given deleted public dashboard', () => {
    it('Should render public dashboard deleted screen', async () => {
      setup(undefined, {
        dashboard: {
          getModel: () => getTestDashboard(undefined, { dashboardNotFound: true }),
          initError: null,
          initPhase: DashboardInitPhase.Completed,
          permissions: [],
        },
      });

      await waitFor(() => {
        expect(screen.queryByTestId(publicDashboardSelector.page)).not.toBeInTheDocument();
        expect(screen.queryByTestId(publicDashboardSelector.NotAvailable.pausedDescription)).not.toBeInTheDocument();
      });
      expect(screen.getByTestId(publicDashboardSelector.NotAvailable.title)).toBeInTheDocument();
    });
  });
});
