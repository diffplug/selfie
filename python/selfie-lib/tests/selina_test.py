from selfie_lib import get_interesting_fact

def test_science_fact():
    fact = get_interesting_fact("science")
    assert fact == "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still perfectly edible."

def test_history_fact():
    fact = get_interesting_fact("history")
    assert fact == "The shortest war in history lasted only 38 minutes. It was between Britain and Zanzibar on August 27, 1896."

def test_animals_fact():
    fact = get_interesting_fact("animals")
    assert fact == "Penguins only have one mate their entire life. They also propose to their lifemates with a pebble."

def test_technology_fact():
    fact = get_interesting_fact("technology")
    assert fact == "The first computer virus was created in 1983 and was called the 'Elk Cloner'. It infected Apple II computers via floppy disks."

def test_invalid_category():
    fact = get_interesting_fact("invalid")
    assert fact == "Sorry, I don't have an interesting fact for that category."
