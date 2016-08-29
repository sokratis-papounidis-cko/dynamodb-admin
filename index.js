const express = require('express')
const AWS = require('aws-sdk')
const promisify = require('es6-promisify')
const path = require('path')
const errorhandler = require('errorhandler')
const { serializeKey, unserializeKey } = require('./util')
const bodyParser = require('body-parser')

require('es7-object-polyfill')

const app = express()
app.set('json spaces', 2)
app.set('view engine', 'ejs')
app.set('views', path.resolve(__dirname, 'views'))

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'key',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'secret',
  endpoint: process.env.DYNAMO_ENDPOINT || 'http://localhost:8000',
  sslEnabled: process.env.DYNAMO_ENDPOINT && process.env.DYNAMO_ENDPOINT.indexOf('https://') === 0,
  region: process.env.AWS_REGION || 'us-east-1'
})

const dynamodb = new AWS.DynamoDB()
const documentClient = new AWS.DynamoDB.DocumentClient()

const listTables = promisify(dynamodb.listTables.bind(dynamodb))
const describeTable = promisify(dynamodb.describeTable.bind(dynamodb))
const scan = promisify(documentClient.scan.bind(documentClient))
const getItem = promisify(documentClient.get.bind(documentClient))
const putItem = promisify(documentClient.put.bind(documentClient))
const deleteItem = promisify(documentClient.delete.bind(documentClient))

app.use(errorhandler())
app.use('/assets', express.static(path.join(__dirname, '/public')))

app.get('/', (req, res) => {
  dynamodb.listTables({}, (error, data) => {
    if (error) {
      res.json({error})
    } else {
      Promise.all(data.TableNames.map((TableName) => {
        return describeTable({TableName}).then((data) => data.Table)
      })).then((data) => {
        res.render('tables', {data})
      }).catch((error) => {
        res.json({error})
      })
    }
  })
})

app.get('/tables/:TableName', (req, res, next) => {
  const TableName = req.params.TableName
  Promise.all([
    describeTable({TableName}),
    scan({
      TableName,
      Limit: 25
    })
  ]).then(([description, result]) => {
    const data = Object.assign({},
      description,
      {
        Items: result.Items.map((item) => {
          return Object.assign({}, item, {
            __key: serializeKey(item, description.Table)
          })
        })
      }
    )
    res.render('scan', data)
  }).catch(next)
})

app.get('/tables/:TableName/meta', (req, res) => {
  const TableName = req.params.TableName
  Promise.all([
    describeTable({TableName}),
    scan({TableName})
  ]).then(([description, items]) => {
    const data = Object.assign({},
      description,
      items
    )
    res.render('meta', data)
  }).catch((error) => {
    res.json({error})
  })
})

app.delete('/tables/:TableName/items/:key', (req, res, next) => {
  const TableName = req.params.TableName
  describeTable({TableName}).then((result) => {
    const params = {
      TableName,
      Key: unserializeKey(req.params.key, result.Table)
    }

    return deleteItem(params).then((response) => {
      res.status(204).end()
    })
  }).catch(next)
})

app.get('/tables/:TableName/items/:key', (req, res, next) => {
  const TableName = req.params.TableName
  describeTable({TableName}).then((result) => {
    const params = {
      TableName,
      Key: unserializeKey(req.params.key, result.Table)
    }

    return getItem(params).then((response) => {
      if (!response.Item) {
        return res.status(404).send('Not found')
      }
      res.render('item', {
        TableName: req.params.TableName,
        Item: response.Item
      })
    })
  }).catch(next)
})

app.put('/tables/:TableName/items/:key', bodyParser.json(), (req, res, next) => {
  const TableName = req.params.TableName
  describeTable({TableName}).then((result) => {
    const params = {
      TableName,
      Item: req.body
    }

    return putItem(params).then(() => {
      const params = {
        TableName,
        Key: unserializeKey(req.params.key, result.Table)
      }
      return getItem(params).then((response) => {
        return res.json(response.Item)
      })
    })
  }).catch(next)
})

const port = process.env.PORT || 8001
app.listen(port, () => {
  console.log(`dynamodb-admin listening on port ${port}`)
})
