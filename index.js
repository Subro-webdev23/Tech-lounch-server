const express = require('express')
const app = express()
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;



app.use(cors());
app.use(express.json());

require('dotenv').config();
const uri = `mongodb+srv://${process.env.USER_DB}:${process.env.USER_PASS}@cluster0.wybojxh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const usersCollection = client.db('assignment-12').collection('users');
        const postsCollection = client.db('assignment-12').collection('posts');
        const reviewsCollection = client.db('assignment-12').collection('reviews');

        // create a user
        app.post('/users', async (req, res) => {
            console.log("Incoming user data:", req.body);
            const email = req.body.email;
            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                // update last log in
                return res.status(200).send({ message: 'User already exists', inserted: false });
            }
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })
        // get all users
        app.get('/users', async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });


        //  Add Product
        app.post('/addProducts', async (req, res) => {
            const product = req.body;
            const result = await postsCollection.insertOne(product);
            res.send(result);
        });
        // Get all products
        app.get('/products', async (req, res) => {
            const products = await postsCollection.find().toArray();
            res.send(products);
        });
        // Get products by Id
        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            const product = await postsCollection.findOne({ _id: new ObjectId(id) });
            res.send(product);
        });
        // 
        app.patch('/products/:id/upvote', async (req, res) => {
            const id = req.params.id;
            const email = req.body.email; // ✅ Make sure you're sending this

            if (!email) {
                return res.status(400).send({ message: 'Email is required for voting.' });
            }

            try {
                const product = await postsCollection.findOne({ _id: new ObjectId(id) });

                if (!product) {
                    return res.status(404).send({ message: 'Product not found' });
                }

                if (product.voters?.includes(email)) {
                    return res.status(400).send({ message: 'Already voted.' });
                }

                const result = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $inc: { upvotes: 1 },
                        $addToSet: { voters: email }
                    }
                );

                res.send(result);
            } catch (error) {
                console.error("Error during upvote:", error);
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });
        // Products report
        app.patch("/products/:id/report", async (req, res) => {
            const id = req.params.id;

            try {
                const result = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isReported: true } }
                );

                res.send(result);
            } catch (err) {
                console.error("Error reporting product:", err);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });
        // Reviews 
        app.post('/reviews', async (req, res) => {
            const { productId, userEmail, userName, userImage, rating, createdAt } = req.body;

            if (!productId || !userEmail || !userName || !rating) {
                return res.status(400).send({ message: "Missing required review fields" });
            }

            try {
                const result = await reviewsCollection.insertOne({
                    productId: new ObjectId(productId),
                    userEmail,
                    userName,
                    userImage,
                    rating,
                    createdAt: createdAt || new Date(),
                });

                res.send(result);
            } catch (error) {
                console.error("Error inserting review:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Assignment 12 server is running')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
