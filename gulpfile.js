const { src, dest, task } = require('gulp');

task('build:icons', () => {
  return src('nodes/Claude/*.svg').pipe(dest('dist/nodes/Claude/'));
});
