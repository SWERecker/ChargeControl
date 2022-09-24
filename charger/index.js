const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
routes(app);

const port = 5580

console.log = () => {}

app.listen(port, () => {
  console.log(`running at port ${port}`);
})
