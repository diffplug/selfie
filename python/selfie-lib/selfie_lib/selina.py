def get_interesting_fact(category):
    facts = {
        "science": "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still perfectly edible.",
        "history": "The shortest war in history lasted only 38 minutes. It was between Britain and Zanzibar on August 27, 1896.",
        "animals": "Penguins only have one mate their entire life. They also propose to their lifemates with a pebble.",
        "technology": "The first computer virus was created in 1983 and was called the 'Elk Cloner'. It infected Apple II computers via floppy disks."
    }
    
    category_lower = category.lower()
    if category_lower in facts:
        return facts[category_lower]
    else:
        return "Sorry, I don't have an interesting fact for that category."


