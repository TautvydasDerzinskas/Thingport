/** Starter category tree modeled on MakerWorld's. Each provider's ids for it, so imports are auto-categorized from the
 * start, are in its own folder: backend/src/providers/<id>/categories.json, by path ("Parent/Child"). */
export type DefaultCategoryNode = {
  name: string;
  tags?: string[];
  metaTitle?: string;
  metaDescription?: string;
  children?: DefaultCategoryNode[];
};

export const DEFAULT_CATEGORIES: DefaultCategoryNode[] = [
  {
    name: "3D Printer",
    metaTitle: "3D Printer",
    metaDescription:
      "Whether you're looking to enhance your 3D printing experience with accessories or need to replace a printer part with a printed one, we have you covered. You can download and print models from a wide selection available just a click away.",
    children: [
      {
        name: "3D Printer Accessories",
        metaTitle: "3D Printer Accessories",
        metaDescription:
          "Elevate your 3D printing experience with our curated selection of premium accessories. Discover a wide range of essential tools and components designed to optimize print quality, enhance performance, and expand the capabilities of your 3D printer.",
      },
      {
        name: "3D Printer Parts",
        metaTitle: "3D Printer Parts & Upgrades",
        metaDescription:
          "Transform your 3D printer into a powerhouse of precision and performance with our extensive range of high-quality 3D printer parts and upgrades. Whether you're seeking to enhance print accuracy, increase printing speed, or expand your printer's functionality, our carefully curated selection of replacement parts and innovative upgrades caters to every need.",
      },
      {
        name: "Test Models",
        metaTitle: "3D Printer Test Models",
        metaDescription:
          "Ensure flawless prints and optimal performance with our collection of essential 3D printer test models. These meticulously designed models provide a comprehensive platform for evaluating printer settings, diagnosing potential issues, and validating print quality.",
      },
    ],
  },
  {
    name: "Art",
    metaTitle: "3D Printed Art Models",
    metaDescription:
      'Explore the "Art" category of 3D printing models and discover a wide range of stunning designs that can be printed and displayed in any environment. From 2D art to sculptures, download premium model files and add a touch of beauty and creativity to your space with these unique designs.',
    children: [
      {
        name: "2D Art",
        metaTitle: "2D Art Models",
        metaDescription:
          "Bring your favorite paintings, drawings, and illustrations to life with our innovative collection of 3D printed 2D art models. Experience the beauty of art in a new dimension as we transform cherished 2D artworks into stunning 3D printed creations.",
      },
      {
        name: "Coin & Badges",
        metaTitle: "3D Printed Coin & Badges",
        metaDescription:
          "Create unique and memorable keepsakes with our collection of customizable 3D printed coins and badges. Commemorate special events, recognize achievements, or simply express your individuality with personalized designs that are sure to impress.",
      },
      {
        name: "Signs & Logos",
        metaTitle: "3D Printed Signs & Logos",
        metaDescription:
          "Elevate your branding and signage with our collection of impactful 3D printed signs and logos. Create custom signage for businesses, events, or home décor that stands out from the crowd.",
      },
      {
        name: "Sculptures",
        metaTitle: "3D Printed Sculptures",
        metaDescription:
          "Explore a world of captivating 3D printed sculptures that showcase the artistry and innovation of this transformative technology. From lifelike figures and abstract forms to intricate details and mesmerizing textures, our curated collection of 3D printed sculptures offers a diverse range of artistic expressions that will inspire and amaze.",
      },
      {
        name: "Other Art Models",
        metaTitle: "Other Art Models",
        metaDescription:
          "Transform your home décor with unique 3D printed art models. Discover vases, lamps, boxes, sculptures, and more!",
      },
    ],
  },
  {
    name: "Education",
    metaTitle: "3D Printed Educational Models",
    metaDescription:
      "Explore 3D printing designs to enhance learning and create interactive educational tools. Discover a wide range of 3D printable models covering subjects such as science, geography, history, mathematics, and more. Ideal for educators and learners of all ages.",
    children: [
      {
        name: "Biology",
        metaTitle: "3D Printed Biology Models",
        metaDescription:
          "Explore the intricate world of life with our meticulously crafted 3D printed biology models, visualizing and understanding anatomy, molecular structures, and biological processes.",
      },
      {
        name: "Chemistry",
        metaTitle: "3D Printed Chemistry Models",
        metaDescription:
          "Unravel the mysteries of matter with our captivating 3D printed chemistry models, visualizing and understanding molecular structures, chemical compounds, and complex reactions.",
      },
      {
        name: "Engineering",
        metaTitle: "3D Printed Engineering Models",
        metaDescription:
          "Transform abstract engineering concepts into tangible realities with our innovative 3D printed models, exploring mechanical components, architectural structures, and electronic circuits.",
      },
      {
        name: "Geography",
        metaTitle: "3D Printed Geography Models",
        metaDescription:
          "Embark on a geographical journey around the world with our captivating 3D printed models, visualizing mountain ranges, continents, oceans, rivers, and climate patterns.",
      },
      {
        name: "Mathematics",
        metaTitle: "3D Printed Mathematics Models",
        metaDescription:
          "Transform abstract mathematical concepts into tangible representations with our engaging 3D printed models, visualizing geometric shapes, mathematical functions, and complex mathematical concepts.",
      },
      {
        name: "Physics & Astronomy",
        metaTitle: "3D Printed Physics & Astronomy Models",
        metaDescription:
          "Unravel the mysteries of the universe with our captivating 3D printed physics and astronomy models, visualizing physical forces, astronomical phenomena, and complex scientific theories.",
      },
      {
        name: "Other Education Models",
        metaTitle: "Other Education Models",
        metaDescription:
          "Discover a world of endless learning possibilities with our diverse collection of 3D printed educational models, exploring history, social studies, art, design, language, and literature.",
      },
    ],
  },
  {
    name: "Fashion",
    metaTitle: "3D Printed Fashion Models",
    metaDescription:
      'Discover contemporary and stylish 3D printable fashion accessories in the "Fashion" category. Create your own unique 3D printed items, from jewelry to purses, wallets, and belts, and express your personal fashion sense with these premium model files.',
    children: [
      {
        name: "Bags",
        metaTitle: "3D Printed Bags",
        metaDescription:
          "Embrace a unique blend of functionality and fashion-forward design with our durable and eco-friendly 3D printed bags, ranging from trendy handbags to practical backpacks.",
      },
      {
        name: "Clothes",
        metaTitle: "3D Printed Clothes Accessories",
        metaDescription:
          "Elevate your style with our eye-catching and personalized 3D printed clothes accessories, from statement-making necklaces and bracelets to bold earrings and scarves.",
      },
      {
        name: "Earrings",
        metaTitle: "3D Printed Earrings",
        metaDescription:
          "Make a statement with our collection of exquisite and unique 3D printed earrings, featuring a wide variety of designs from delicate and feminine to bold and geometric.",
      },
      {
        name: "Footwear",
        metaTitle: "3D Printed Footwear",
        metaDescription:
          "Experience the ultimate in comfort and style with our innovative and customizable 3D printed footwear, designed to provide exceptional support and make a fashion statement.",
      },
      {
        name: "Glasses",
        metaTitle: "3D Printed Glasses",
        metaDescription:
          "See the world in a new light with our stylish and functional 3D printed glasses, offering a variety of frames and lenses to create both fashionable and practical eyewear.",
      },
      {
        name: "Jewelry",
        metaTitle: "3D Printed Jewelry",
        metaDescription:
          "Make one-of-a-kind pieces of jewelry with our amazing 3D printed jewelry, featuring a wide range of designs from delicate and intricate to bold and statement-making.",
      },
      {
        name: "Rings",
        metaTitle: "3D Printed Rings",
        metaDescription:
          "Find the perfect ring to symbolize your love or commitment with our unique and personalized 3D printed rings, including classic wedding bands, modern statement rings, and personalized rings with custom engravings.",
      },
      {
        name: "Other Fashion Models",
        metaTitle: "Other Fashion Models",
        metaDescription:
          "Discover a world of endless fashion possibilities with our diverse collection of 3D printed fashion models, including hats, belts, and hair accessories.",
      },
    ],
  },
  {
    name: "Hobby & DIY",
    metaTitle: "3D Printed Hobby & DIY Models",
    metaDescription:
      "3D Printers are awesome if you are into DIY activities. And this category is just as awesome as a resource for your 3D printing needs related to your DIY hobby. From electronics to RC vehicles or Robotics, you'll find something to get busy with.",
    children: [
      {
        name: "Electronics",
        metaTitle: "3D Printed Equipments for Electronics",
        metaDescription:
          "Elevate your electronics projects with our precision-crafted 3D printed electronic components, enclosures, and accessories.",
      },
      {
        name: "Music",
        metaTitle: "3D Printed Musical Instruments",
        metaDescription:
          "Create unique and personalized 3D printed musical instruments, from flutes and drums to guitars and synthesizers.",
      },
      {
        name: "RC",
        metaTitle: "3D Printed RC Models",
        metaDescription:
          "Experience the thrill of crafting and controlling your own 3D printed RC vehicles, drones, and airplanes.",
      },
      {
        name: "Robotics",
        metaTitle: "3D Printed Robotics",
        metaDescription:
          "Explore the world of robotics with our amazing 3D printed robot parts, frames, and actuators.",
      },
      {
        name: "Sport & Outdoors",
        metaTitle: "3D Printed Sport & Outdoor Models",
        metaDescription:
          "Unleash your athletic spirit and explore the outdoors with Sport & Outdoor! Craft custom gear, design personalized accessories, and discover a world of 3D printed models to fuel your active lifestyle. Start your Sport & Outdoor 3D printing today!",
      },
      {
        name: "Vehicles",
        metaTitle: "3D Printed Vehicles",
        metaDescription:
          "Design and build your dream 3D printed vehicles, from cars and motorcycles to spaceships and submarines.",
      },
      {
        name: "Other Hobby & DIY",
        metaTitle: "Other Hobby & DIY Models",
        metaDescription:
          "Discover endless possibilities for creativity and self-expression with our diverse collection of 3D printed hobby and DIY models.",
      },
    ],
  },
  {
    name: "Household",
    metaTitle: "3D Printed Household Models",
    metaDescription:
      "If you're reading this, then you probably need to fix or upgrade something in your household by printing one of the various models available. From regular door handles to complex decor designs or useful upgrades for your garden, we're sure there's something useful for you. So get printing!",
    children: [
      {
        name: "Decor",
        metaTitle: "3D Printed Home Decor",
        metaDescription:
          "Elevate your home décor with our unique and eye-catching 3D printed vases, sculptures, wall hangings, and other decorative items.",
      },
      {
        name: "Festivities",
        metaTitle: "3D Printed Festival Models",
        metaDescription:
          "Celebrate special occasions and holidays with our festive 3D printed decorations, ornaments, and figurines.",
      },
      {
        name: "Garden",
        metaTitle: "3D Printed Garden Models",
        metaDescription:
          "Transform your outdoor spaces into a whimsical wonderland with our charming and customizable 3D printed garden ornaments, planters, and sculptures.",
      },
      {
        name: "Office",
        metaTitle: "3D Printed Office Models",
        metaDescription:
          "Enhance your workspace with our functional and stylish 3D printed office organizers, pen holders, and desk accessories.",
      },
      {
        name: "Pets",
        metaTitle: "3D Printed Pet Models",
        metaDescription:
          "Create personalized pet accessories and toys with our customizable 3D printed pet tags, bowls, and toys.",
      },
      {
        name: "Other Household Models",
        metaTitle: "Other Household Models",
        metaDescription:
          "Discover a world of endless possibilities for home organization, personalization, and fun with our diverse collection of 3D printed household models.",
      },
    ],
  },
  {
    name: "Miniatures",
    metaTitle: "3D Printed Miniatures",
    metaDescription:
      "If you like miniatures, then you've come to the right place. From mystical creatures and animals to architectural designs, we're sure you will find something to spice up your game night!",
    children: [
      {
        name: "Animals",
        metaTitle: "3D Printed Animals",
        metaDescription:
          "Populate your gaming worlds with our realistic and detailed 3D printed animals, from majestic dragons to playful pets.",
      },
      {
        name: "Architecture",
        metaTitle: "3D Printed Architectures",
        metaDescription:
          "Construct stunning and realistic 3D printed buildings, castles, and other architectural wonders for your miniature landscapes.",
      },
      {
        name: "Creatures",
        metaTitle: "3D Printed Creatures",
        metaDescription:
          "Unleash your imagination with our collection of fantastical 3D printed creatures, from mythical monsters to mischievous fairies.",
      },
      {
        name: "People",
        metaTitle: "3D Printed People",
        metaDescription:
          "Create diverse and realistic 3D printed characters for your tabletop games, role-playing adventures, and dioramas.",
      },
      {
        name: "Other Miniatures",
        metaTitle: "Other Miniatures",
        metaDescription:
          "Discover a vast array of unique and personalized 3D printed miniatures to enhance your gaming experiences and collections.",
      },
    ],
  },
  {
    name: "Props & Cosplays",
    metaTitle: "3D Printed Props & Cosplays",
    metaDescription:
      "Even if it's not Halloween, there's always time for printing a cool mask, helmet or other cosplay-related prints. Don't wait until it's too late, and start printing your awesome new outfit!",
    children: [
      {
        name: "Costumes",
        metaTitle: "3D Printed Costumes",
        metaDescription:
          "Create stunning and authentic 3D printed costumes, from superhero suits to fantasy armor, for your next cosplay event or Halloween.",
      },
      {
        name: "Masks & Helmets",
        metaTitle: "3D Printed Masks & Helmets",
        metaDescription:
          "Elevate your cosplay with our detailed and realistic 3D printed masks, helmets, and other facial accessories.",
      },
      {
        name: "Cosplay Weapons",
        metaTitle: "3D Printed Props for Cosplay Weapons",
        metaDescription:
          "Dive into the amazing cosplay world with our 3D printed props! We've got finely designed swords and shields, ideal for you to embody your favorite characters. Unleash their power and enjoy immersive role-playing!",
      },
      {
        name: "Other Props & Cosplays",
        metaTitle: "Other Props & Cosplays",
        metaDescription:
          "Enhance your cosplay with our diverse collection of 3D printed props, accessories, and gadgets to complete your transformation.",
      },
    ],
  },
  {
    name: "Tools",
    metaTitle: "3D Printed Tools",
    metaDescription:
      "There's never enough tools to have, or a way to organize those tools in an efficient manner. But this section is the perfect location to find the files you need to print a specific jig or an organizer for your latest gadget.",
    children: [
      {
        name: "Gadgets",
        metaTitle: "3D Printed Gadgets",
        metaDescription:
          "Uncover a world of possibilities with our collection of unique and practical 3D printed gadgets, from phone holders to desk organizers.",
      },
      {
        name: "Hand Tools",
        metaTitle: "3D Printed Hand Tools",
        metaDescription:
          "Enhance your toolbox with our durable and customizable 3D printed hand tools, wrenches, and screwdrivers.",
      },
      {
        name: "Machine Tools",
        metaTitle: "3D Printed Machine Tools",
        metaDescription:
          "Upgrade your workshop with our precision-crafted 3D printed machine tools, jigs, and fixtures.",
      },
      {
        name: "Measure Tools",
        metaTitle: "3D Printed Measure Tools",
        metaDescription:
          "Ensure precise measurements with our accurate and versatile 3D printed measuring tools, rulers, and calipers.",
      },
      {
        name: "Medical Tools",
        metaTitle: "3D Printed Medical Tools",
        metaDescription:
          "Experience the future of medicine with our innovative 3D printed medical tools, surgical guides, and implants.",
      },
      {
        name: "Organizers",
        metaTitle: "3D Printed Organizers",
        metaDescription:
          "Keep your workspace and belongings tidy with our functional and customizable 3D printed organizers, trays, and containers.",
      },
      {
        name: "Other Tools",
        metaTitle: "Other Tools",
        metaDescription:
          "Discover a vast array of specialized and niche 3D printed tools to meet your specific needs and interests.",
      },
    ],
  },
  {
    name: "Toys & Games",
    metaTitle: "3D Printed Toys & Games",
    metaDescription:
      "This section is dedicated to printable fun! You will find various board games, toys, puzzles and games which are all ready to be printed and enjoyed after a quick print.",
    children: [
      {
        name: "Board Games",
        metaTitle: "3D Printed Board Games",
        metaDescription:
          "Elevate your game nights with our unique and customizable 3D printed board games, chess sets, and game pieces.",
      },
      {
        name: "Characters",
        metaTitle: "3D Printed Characters",
        metaDescription:
          "Create your own personalized 3D printed characters, action figures, and dolls for imaginative play and storytelling.",
      },
      {
        name: "Outdoor Toys",
        metaTitle: "3D Printed Outdoor Toys",
        metaDescription:
          "Encourage active play and outdoor adventures with our durable and engaging 3D printed outdoor toys, frisbees, and sports equipment.",
      },
      {
        name: "Puzzles",
        metaTitle: "3D Printed Puzzles",
        metaDescription:
          "Challenge your mind and test your problem-solving skills with our intricate and captivating 3D printed puzzles.",
      },
      {
        name: "Construction Sets",
        metaTitle: "3D Printed Construction Sets",
        metaDescription:
          "Build and create incredible structures with our versatile and educational 3D printed construction sets, from classic building blocks to STEM-inspired designs.",
      },
      {
        name: "Other Toys & Games",
        metaTitle: "Other Toys & Games",
        metaDescription:
          "Discover a world of endless possibilities for play, learning, and creativity with our diverse collection of 3D printed toys and games.",
      },
    ],
  },
  {
    name: "Generative 3D Model",
    metaTitle: "Generative 3D Model",
    metaDescription:
      "Here you can find creative models built using 3D model generators. They are beautifully crafted and may provide inspiration on how to utilize these generators.",
    children: [
      {
        name: "Hueforge & Lithophane",
        metaTitle: "Hueforge & Lithophane",
        metaDescription:
          "Transform your favorite images into stunning 3D art pieces with Hueforge and create mesmerizing lithophanes that glow with light.",
      },
      {
        name: "Make My Sign",
        metaTitle: "Make My Sign",
        metaDescription:
          "Create personalized and eye-catching signs using our user-friendly Make My Sign tool, perfect for home décor, businesses, and special occasions.",
      },
      {
        name: "Make My Vase",
        metaTitle: "Make My Vase",
        metaDescription:
          "Design and customize unique and beautiful vases with our intuitive Make My Vase tool, from simple shapes to intricate patterns, solid or hollow.",
      },
      {
        name: "Pixel Puzzle Maker",
        metaTitle: "Pixel Puzzle Maker",
        metaDescription:
          "Convert your cherished images into captivating pixel art puzzles using our Pixel Puzzle Maker tool, perfect for fun challenges and creative displays.",
      },
      {
        name: "Relief Sculpture Maker",
        metaTitle: "Relief Sculpture Maker",
        metaDescription:
          "Elevate your artwork with our 3D to Relief Sculpture tool, seamlessly transforming 3D models or images into stunning bas-relief sculptures.",
      },
      {
        name: "AI Scanner",
        metaTitle: "AI Scanner",
        metaDescription:
          "Recreate 3D assets with remarkable accuracy using our AI Scanner tool, simply capture a continuous video and let the AI do the rest.",
      },
      {
        name: "Image to Keychain",
        metaTitle: "Image to Keychain",
        metaDescription: "Turns images into keychains, bookmarks and other 2D Art models.",
      },
      {
        name: "Make My Desk Organizer",
        metaTitle: "Make My Desk Organizer",
        metaDescription: "Design your perfect desk organizer. Customize every detail to fit exactly what you need.",
      },
      {
        name: "PrintMon Maker",
        metaTitle: "PrintMon Maker",
        metaDescription: "Generate adorable creatures from text or images, ready for 3D printing.",
      },
      {
        name: "Statue Maker",
        metaTitle: "Statue Maker",
        metaDescription: "Turn Your Portrait into a Lifelike 3D Masterpiece.",
      },
      {
        name: "Christmas Ornament Maker",
        metaTitle: "Christmas Ornament Maker",
        metaDescription:
          "Create personalized, spinning 2D Christmas ornaments with the Christmas Ornament Maker, perfect for decorations or gifts.",
      },
      {
        name: "Make My Lantern",
        metaTitle: "Make My Lantern",
        metaDescription: "Generate a hollowed lantern from an image.",
      },
    ],
  },
];
