const express = require('express')
const app = express()
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
require('dotenv').config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

app.use(cors());
app.use(express.json());



const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


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

        // Custom middleware 
        const varifyFBToken = async (req, res, next) => {
            const authHeaders = req.headers.authorization;
            if (!authHeaders) {
                return res.status(401).send({ message: 'Unauthorized access' });
            }
            const token = authHeaders.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'Unauthorized access' });
            }
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            } catch (error) {
                console.error("Firebase token verification error:", error);
                res.status(403).send({ message: 'forbidden access' });
            }


        }

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
            const productData = req.body;
            const email = productData?.email;
            const user = await usersCollection.findOne({ email });
            if (!user) {
                return res.status(403).send({ success: false, message: 'User not found' });
            }
            if (!user.subscribed) {
                const existingProductCount = await postsCollection.countDocuments({ email });

                if (existingProductCount >= 1) {
                    return res.status(403).send({
                        success: false,
                        message: 'You can only add 1 product without subscription.'
                    });
                }
            }
            const result = await postsCollection.insertOne(productData);
            res.send(result);
        });
        // Get all products
        app.get('/products', varifyFBToken, async (req, res) => {
            const products = await postsCollection.find().toArray();
            res.send(products);
        });
        // Get products by Id
        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            const product = await postsCollection.findOne({ _id: new ObjectId(id) });
            res.send(product);
        });
        // Get products by email
        app.get('/posts/:email', varifyFBToken, async (req, res) => {
            const ownerEmail = req.params.email;
            const query = { email: ownerEmail };

            try {
                const products = await postsCollection.find(query).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send({ message: 'Server error' });
            }
        });
        // 
        // Update product by ID
        app.patch('/products/:id', async (req, res) => {
            const { id } = req.params;
            const updatedProduct = req.body;

            try {
                const result = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            name: updatedProduct.name,
                            description: updatedProduct.description,
                            image: updatedProduct.image,
                            link: updatedProduct.link,
                            tags: updatedProduct.tags, // must be an array
                        }
                    }
                );

                res.send(result);
            } catch (error) {
                console.error("Error updating product:", error);
                res.status(500).send({ message: "Failed to update product." });
            }
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
            const email = req.body.email;

            const product = await postsCollection.findOne({ _id: new ObjectId(id) });

            let result;
            let action;

            if (product?.reported?.includes(email)) {
                // If already reported, pull (unreport)
                result = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $pull: { reported: email } }
                );
                action = "unreported";
            } else {
                // Otherwise, push (report)
                result = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $addToSet: { reported: email } }
                );
                action = "reported";
            }

            res.send({ success: true, action });
        });
        // Reviews 
        app.post('/reviews', async (req, res) => {
            const { productId, userEmail, userName, userImage, description, rating, createdAt } = req.body;

            if (!productId || !userEmail || !userName || !rating) {
                return res.status(400).send({ message: "Missing required review fields" });
            }

            try {
                const result = await reviewsCollection.insertOne({
                    productId: new ObjectId(productId),
                    userEmail,
                    userName,
                    userImage,
                    description,
                    rating,
                    createdAt: createdAt || new Date(),
                });

                res.send(result);
            } catch (error) {
                console.error("Error inserting review:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // Get reviews by product ID
        app.get('/reviews/:productId', varifyFBToken, async (req, res) => {
            const productId = req.params.productId;

            try {
                const reviews = await reviewsCollection.find({ productId: new ObjectId(productId) }).toArray();
                res.send(reviews);
            } catch (error) {
                console.error("Error fetching reviews:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });
        // Reported products to view moderators
        app.get('/reportedProducts', varifyFBToken, async (req, res) => {
            try {
                const reportedPosts = await postsCollection.find({
                    reported: { $exists: true, $not: { $size: 0 } }
                }).toArray();

                res.send(reportedPosts);
            } catch (error) {
                console.error("Failed to fetch reported posts:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });
        // user role update
        app.patch('/users/:id/role', async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;
            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );
            res.send(result);
        });
        // GET: Get user role by email
        app.get('/users/:email/role', varifyFBToken, async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({
                    email: email
                });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

        // DELETE: Delete a Product by ID
        app.delete('/posts/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const result = await postsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount > 0) {
                    res.send({ success: true, deletedCount: result.deletedCount });
                } else {
                    res.status(404).send({ success: false, message: 'Product not found' });
                }
            } catch (error) {
                console.error("Error deleting product:", error);
                res.status(500).send({ success: false, message: 'Server error while deleting product' });
            }
        });
        // PATCH: Update a Product isFeatured Status
        app.patch('/posts/:id', async (req, res) => {
            const id = req.params.id;
            const { isFeatured } = req.body;

            try {
                const result = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isFeatured } }
                );

                res.send(result);
            } catch (error) {
                console.error("Error updating status:", error);
                res.status(500).send({ message: "Server error" });
            }
        });
        // PATCH: Update a Product Status
        app.patch('/productStatus/:id', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            // console.log("Body received:", req.body);
            try {
                const result = await postsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: status } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });
        // GET: Get user role by email
        // app.get('/users/:email/role', async (req, res) => {
        //     try {
        //         const email = req.params.email;

        //         if (!email) {
        //             return res.status(400).send({ message: 'Email is required' });
        //         }

        //         const user = await usersCollection.findOne({ email });

        //         if (!user) {
        //             return res.status(404).send({ message: 'User not found' });
        //         }

        //         res.send({ role: user.role || 'user' });
        //     } catch (error) {
        //         console.error('Error getting user role:', error);
        //         res.status(500).send({ message: 'Failed to get role' });
        //     }
        // });
        // GET: Get all users by Email
        app.get('/users/email/:email', async (req, res) => {
            const email = req.params.email;
            try {
                const user = await usersCollection.findOne({ email });
                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }
                res.send(user);
            } catch (error) {
                console.error('Error fetching user by email:', error);
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });
        // Payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const subscriptionInCents = req.body.subscriptionInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: subscriptionInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // PUT: subscribtion status true
        app.put('/users/:email/subscription', async (req, res) => {
            const email = req.params.email;
            const { subscribed } = req.body;

            try {
                const result = await usersCollection.updateOne(
                    { email: email },
                    { $set: { subscribed } }
                );

                if (result.modifiedCount > 0) {
                    res.send({ success: true, message: 'Subscription status updated successfully' });
                } else {
                    res.status(404).send({ success: false, message: 'User not found or no changes made' });
                }
            } catch (error) {
                console.error("Error updating subscription status:", error);
                res.status(500).send({ success: false, message: 'Server error while updating subscription status' });
            }
        })


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
