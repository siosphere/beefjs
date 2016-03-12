var gulp = require('gulp');
var concat = require('gulp-concat');
var uglify = require('gulp-uglify');
var ts = require('gulp-typescript');
var babel = require('gulp-babel');

var files = [
    './src/Beef/resources/dependencies.ts',
    './src/Beef/resources/package.ts',
];

gulp.task('default', function(){
    gulp.src(files)
    .pipe(ts({
        sortOutput: true,
        declarationFiles: true,
        out: "beef.js"
    }))
    .pipe(concat('beef.js'))
    .pipe(gulp.dest('./dist/'));
});

gulp.task('minify', function(){
    gulp.src(files)
    .pipe(ts({
        sortOutput: true,
        declarationFiles: true,
        out: "beef.js"
    }))
    .pipe(concat('beef.min.js'))
    .pipe(uglify())
    .pipe(gulp.dest('./dist/'));
});


/**
 * EXAMPLES
 */

var bower = function(path)
{
    return './bower_components/' + path;
};

var Examples = {
    js: {},
    typescript: {}
};

gulp.task('examples', ['minify', 'examples.js.todoReact']);

// Todo React Example
Examples.js.todoReact = {
    files: [
        bower('jquery/dist/jquery.min.js'),
        bower('moment/min/moment.min.js'),
        bower('react/react.js'),
        bower('react/react-dom.js'),
        './dist/beef.min.js',
        './examples/js/todo-react/src/js/**/*',
        './examples/js/todo-react/src/jsx/**/*'
    ],
    compiled: 'todo.js',
    dest: './examples/js/todo-react/dist/'
};

gulp.task('examples.js.todoReact', function() {
    gulp.src(Examples.js.todoReact.files)
    .pipe(babel({
        presets: ['react']
    }))
    .pipe(concat(Examples.js.todoReact.compiled))
    .pipe(gulp.dest(Examples.js.todoReact.dest))
    ;
});