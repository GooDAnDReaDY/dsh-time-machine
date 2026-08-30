window.__ModuleLoader__.load({
  id: '@goodandready-private/dsh-time-machine',
  factory: (require) => {
    var module = { exports: {} };
    const React = require('react');

    const NS = '@goodandready-private/dsh-time-machine';

    function PluginCard({ ctx }) {
      const [expanded, setExpanded] = React.useState(false);
      return React.createElement('div', { className: 'time-machine-card' },
        React.createElement('button', {
          className: 'time-machine-head',
          onClick: () => setExpanded(!expanded)
        },
          React.createElement('span', { className: 'time-machine-title' }, 'Time Machine & Checkpoints')
        )
      );
    }

    module.exports.inject = ['slots'];
    module.exports.apply = function apply(ctx) {
      if (ctx.slots) {
        ctx.slots.register({
          name: 'settings.plugin.item',
          key: NS,
          locale: NS,
          inject: () => ({ ctx })
        }, PluginCard);
      }
    };

    return module.exports;
  }
});
