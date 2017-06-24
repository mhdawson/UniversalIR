const readline = require('readline');

const std = readline.createInterface({
  input: process.stdin
});

var curline = 0;
var result = ''
std.on('line', (line) => {
  if (curline === 0) {
    result = '{ "button": "' + process.argv[2]  + '", "values": [\n  ';  
    curline++;
    return;
  }

  const parts = line.split(" ");
  if (curline !== 1) {
    result = result + ',';
  }  

  if ((curline % 8) === 0) {
    result = result + '\n  ';
  } 
 
  result = result + parts[1];
  curline++;
});

std.on('close', () => {
  result = result + '] }'  
  console.log(result);
  process.exit(0);
});
