import { sequelize, Category, Product } from './models/index.js';

const seedData = async () => {
    try {
        await sequelize.sync({ force: false }); // Do not drop existing tables

        // 1. Create Sample Categories
        const categories = await Category.bulkCreate([
            { name: 'Appetizers' },
            { name: 'Main Courses' },
            { name: 'Beverages' },
            { name: 'Desserts' }
        ]);

        console.log('✅ Sample Categories created');

        // 2. Create Sample Products associated with Categories
        await Product.bulkCreate([
            {
                name: 'Abalone Soup',
                category_id: categories[0].id,
                price: 150000,
                description: 'Premium abalone soup with shiitake mushrooms',
                prep_time_minutes: 20,
                stock_quantity: 50,
                image_url: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?q=80&w=1000&auto=format&fit=crop'
            },
            {
                name: 'Pan-Seared Wagyu Beef',
                category_id: categories[1].id,
                price: 850000,
                description: 'Japanese Wagyu beef served with red wine sauce',
                prep_time_minutes: 45,
                stock_quantity: 20,
                image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000&auto=format&fit=crop'
            },
            {
                name: 'Cabernet Red Wine',
                category_id: categories[2].id,
                price: 1200000,
                description: 'Imported red wine from the Bordeaux region',
                prep_time_minutes: 5,
                stock_quantity: 10,
                image_url: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?q=80&w=1000&auto=format&fit=crop'
            }
        ]);

        console.log('Sample Products created');
        process.exit();
    } catch (error) {
        console.error('Seeding Error:', error);
        process.exit(1);
    }
};

seedData();
