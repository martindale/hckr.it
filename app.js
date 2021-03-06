var couchapp = require('couchapp'), 
    path = require('path');

ddoc = { 
    _id:'_design/news',
    rewrites : [
        {from:'/', to:'_list/all/all', query: { descending: "true" } },
        {from:'/newest', to:'_list/all/newest', query: { descending: "true" } },
        {from:'/item', to:'_list/item/item', query: { key: ":id" } },
        {from:'/user', to:'_list/user/user', query: { key: ":id", group: "true" } },
        {from:'/about', to:'_show/about'},
        {from:'/login', to:'_show/login'},
        {from:'/submit', to:'_show/submit'},
        {from:'/r', to:'_update/item'},
        {from:'/*', to:'*'}
    ]
};

ddoc.views = {};
ddoc.views.all = {
    map: function(doc) {
        if(doc.type === 'item') {
            var util = require('views/lib/util');

            var points = util.getPoints(doc.voted);
            var score = util.findScore(points, doc.created_at);

            var numcomments = util.getNumComments(doc.comments);

            emit(score, {
                doc: doc,
                domain: util.getDomain(doc.url),
                points: points,
                numcomments: numcomments
            });
        }
    }
};

ddoc.views.newest = {
    map: function(doc) {
        if(doc.type === 'item') {
            var util = require('views/lib/util');

            emit(doc.created_at, {
                doc: doc,
                domain: util.getDomain(doc.url),
                points: util.getPoints(doc.voted),
                numcomments: util.getNumComments(doc.comments)            
            });
        }
    }
};

ddoc.views.item = {
    map: function(doc) {
        if(doc.type === 'item') {
            var util = require('views/lib/util');

            var points = util.getPoints(doc.voted);
            var score = util.findScore(points, doc.created_at);

            var numcomments = util.getNumComments(doc.comments);

            var comments = [];
            for(var i in doc.comments) {
                var c = doc.comments[i];
                var comment = {};

                // copy elements of comments since we
                // can't modify the object itself
                for(var x in c) {
                    comment[x] = c[x];
                }

                comment.points = util.getPoints(c.voted);
                comment.score = util.findScore(comment.points, c.comment_id);
                comment.text = util.formatdoc(comment.text);

                comments.push(comment);
            }

            emit(doc._id, {
                doc: doc,
                domain: util.getDomain(doc.url),
                points: points,
                numcomments: numcomments,
                comments: comments
            });
        }
    }
};

ddoc.views.user = {
    map: function(doc) {
        if(doc.type === 'item') {
            var util = require('views/lib/util');

            var points = util.getPoints(doc.voted);

            for(var i in doc.comments) {
                var comment = doc.comments[i];
                emit(comment.author, { points: util.getPoints(comment.voted) });
            }
            emit(doc.author, { points: points });
        }
    },
    reduce: function (key, values, rereduce) {
        var ret = {
            totalPoints: 0
        };
        if(!rereduce) {
            for(var i in values) {
                ret.totalPoints += values[i].points;
            }
        } else {
            for(var i in values) {
                ret.totalPoints += values[i].totalPoints;
            }
        }

        return ret;
    }
}

ddoc.lists = {};
ddoc.lists.all = function(head, req) {
    provides('html', function(){
        var row,
            Mustache = require('views/lib/mustache');
        var util = require('views/lib/util');

        var username = req.userCtx.name;

        var data = {
            title: '',
            username: username,
            login: !(username),
            rows: []
        };

        var counter = 0;
        while(row = getRow()) {
            var doc = row.value.doc;
            doc.domain = row.value.domain;
            doc.points = row.value.points;
            doc.numcomments = row.value.numcomments;

            doc.counter = ++counter;
            doc.pretty_date = util.timeDifference(new Date(), new Date(doc.created_at));

            doc.owner = (doc.author == req.userCtx.name);
            if(util.inArray(username, doc.voted)) {
                doc.upvoted = true;
            }

            data.rows.push(doc);
        }
        var html = Mustache.to_html(this.templates.all, data, this.templates.partials);
        return html;
    });
};

ddoc.lists.item = function(head, req) {
    provides('html', function(){
        var Mustache = require('views/lib/mustache');
        var util = require('views/lib/util');
        
        var username = req.userCtx.name;

        var value = getRow()['value'];
        var currDate = new Date();
        
        var doc = value.doc;
        doc.domain = value.domain;
        doc.points = value.points;
        doc.numcomments = value.numcomments;
        doc.pretty_date = util.timeDifference(currDate, new Date(doc.created_at));

        // check if we upvoted already
        if(util.inArray(username, doc.voted)) {
            doc.upvoted = true;
        }

        for(var i in value.comments) {
            var comment = value.comments[i];
            if(util.inArray(username, comment.voted)) {
                comment.upvoted = true;
            } else {
                comment.upvoted = false;
            }

            if(comment.author === username) {
                comment.owner = true;
            } else {
                comment.owner = false;
            }
            comment.pretty_date = util.timeDifference(currDate, new Date(comment.comment_id));
        }

        var data = {
            title: doc.title + ' | ',
            username: req.userCtx.name,
            login: !(req.userCtx.name),
            item: doc,
            owner: doc.author == username,
            comments: value.comments
        };

        var html = Mustache.to_html(this.templates.item, data, this.templates.partials);
        return html;
    });
}

ddoc.lists.user = function(head, req) {
    provides('html', function(){
        var Mustache = require('views/lib/mustache');

        var username = req.userCtx.name;
        var row = getRow();
        var value = row.value;

        var user = {};
        user.name = row.key;
        user.karma = value.totalPoints;

        var data = {
            title: user.name + ' | ',
            username: username,
            login: !(username),
            user: user,
            myprofile: user.name === username
        };

        var html = Mustache.to_html(this.templates.user, data, this.templates.partials);
        return html;
    });
}


ddoc.shows = {};
ddoc.shows.submit = function(doc, req) {
    var Mustache = require('views/lib/mustache');

    var data = {
        title: 'Submit | ',
        username: req.userCtx.name,
        login: !(req.userCtx.name)
    };

    var html = Mustache.to_html(this.templates.submit, data, this.templates.partials);
    return html;
}
ddoc.shows.login = function(doc, req) {
    var Mustache = require('views/lib/mustache');

    var data = {
        title: 'Login | ',
        username: req.userCtx.name,
        login: !(req.userCtx.name)
    };

    var html = Mustache.to_html(this.templates.login, data, this.templates.partials);
    return html;
}
ddoc.shows.about = function(doc, req) {
    var Mustache = require('views/lib/mustache');

    var data = {
        title: 'About | ',
        username: req.userCtx.name,
        login: !(req.userCtx.name)
    };

    var html = Mustache.to_html(this.templates.about, data, this.templates.partials);
    return html;
}

ddoc.updates = {};
ddoc.updates.item = function(doc, req) {
    var title = req.form.t;
    var url = req.form.u;

    if(!doc) {
        doc = {};
        doc._id = req.uuid;
        // http://stackoverflow.com/questions/4812235/whats-the-best-way-to-store-datetimes-timestamps-in-couchdb
        doc.created_at = JSON.parse(JSON.stringify(new Date));
        doc.author = req.userCtx.name;
        doc.voted = [doc.author];
    }

    doc.title = title;
    doc.url = url;
    doc.type = 'item';
    
    return [doc, {
        'headers' : {
            'Location' : '/'
        }
    }];
}

ddoc.updates.voteup = function(doc, req) {
    var username = req.userCtx.name;
    if(!doc.voted) doc.voted = [];
    doc.voted.push(username);
    return [doc, 'upvoted'];
}
ddoc.updates.commentvoteup = function(doc, req) {
    var username = req.userCtx.name;
    var comment_id = req.form.comment_id;

    // find this comment_id
    for(var i in doc.comments) {
        var comment = doc.comments[i];
        if(comment.comment_id === comment_id) {
            // found our comment, upvote!
            if(!comment.voted) comment.voted = [];
            comment.voted.push(username);
            break;
        }
    }

    return [doc, 'upvoted comment'];
}

ddoc.updates.comment = function(doc, req) {
    if(!doc.comments) doc.comments = [];
    var author = req.userCtx.name;
    var comment = {
        comment_id: JSON.parse(JSON.stringify(new Date)),
        parent_id: req.form.parent_id,
        text: req.form.text,
        voted: [author],
        author: author
    };

    doc.comments.push(comment);

    return [doc, 'commented'];
}

ddoc.validate_doc_update = function (newDoc, oldDoc, userCtx) {
    function forbidden(message) {    
        throw({forbidden : message});
    };

    function unauthorized(message) {
        throw({unauthorized : message});
    };

    function require(field, message) {
        message = message || "Document must have a " + field;
        if (!newDoc[field]) forbidden(message);
    };

    function unchanged(field) {
        require(field);
        if (oldDoc && toJSON(oldDoc[field]) != toJSON(newDoc[field]))
            throw({forbidden : "Field can't be changed: " + field});
    }

    var diffArrays = function(newArr, a) {
        return newArr.filter(function(i) {return !(a.indexOf(i) > -1);});
    };

    function isArray( obj ) {
        return toString.call(obj) === "[object Array]";
    }

    function sameArray(array1, array2) {
        return (array1.sort().join(',') === array2.sort().join(','));
    }

    function objectEquals(obj1, obj2) {
        for (var i in obj1) {
            if (obj1.hasOwnProperty(i)) {
                if (!obj2.hasOwnProperty(i)) return false;
                if (obj1[i] != obj2[i]) return false;
            }
        }
        for (var i in obj2) {
            if (obj2.hasOwnProperty(i)) {
                if (!obj1.hasOwnProperty(i)) return false;
                if (obj1[i] != obj2[i]) return false;
            }
        }
        return true;
    }

    function validDate(dateStr) {
        var date = new Date(dateStr);
        if(date == 'Invalid Date') return false;

        // this current date shouldn't be more than 1 minute before NOW
        var elapsed = new Date() - date;
        var msPerMinute = 60 * 1000;
        var minutesPassed = Math.round(elapsed/msPerMinute)

        if(minutesPassed > 1) return false;
        return true;
    }

    // takes care of making sure votes are the same
    function validateVotes(newVotes, oldVotes) {
        if(!sameArray(newVotes, oldVotes)) { // means arrays are different - either upvote or hijack
            // be sure the new array is the same size  +1 (the new vote)
            if((newVotes.length - 1) !== oldVotes.length) {
                unauthorized("The number of votes you're adding doesn't match. You're fucking shit up!");
            }

            // since it's an upvote, check that we didn't vote it already
            for(var i=0; i<oldVotes.length; i++) {
                if(oldVotes[i] === username) { 
                    unauthorized("You already upvoted this");
                } 
            }

            var diff = diffArrays(newVotes, oldVotes); 
            if(diff.length > 1) {
                unauthorized("You've added too many votes, hacker!");
            } else if(diff.length === 1) { // seems like a legit vote - see if it's the username
                var newVote = diff[0];
                if(newVote !== username) {
                    unauthorized("You're adding a vote as someone else! CRACKER SMACKER");
                }
            }
        }
    }
    function isUrl(s) {
        return s.match(/(^|\s)((https?:\/\/)?[\w-]+(\.[\w-]+)+\.?(:\d+)?(\/\S*)?)/gi);
    }

    // are we logged in?
    var username = userCtx.name;
    if(!username || typeof username != "string" || username.length<1){
        unauthorized("Must be logged on");
    }

    // make sure only admins can delete docs
    if(newDoc._deleted === true && userCtx.roles.indexOf('_admin') === -1) {
        forbidden("Only admin can delete documents on this database.");
    }

    // if we're deleting, skip the rest and just delete
    if(newDoc._deleted === true) return;


    unchanged("type");

    var type = newDoc.type;
    switch(type) {
        case "item": 
            unchanged("created_at");
            unchanged("author");
            require("title");
            require("url");
            require("voted");
            break;
    }

    // if we're creating a document the first time, the author must be the username
    if(!oldDoc) {
        if(newDoc.author !== username) {
            forbidden("You can't create a document with author as someone else other than you");
        }
        // check format of date
        if(!validDate(newDoc.created_at)) {
            forbidden("Invalid date");
        }
    }

    // in case we're editing someone elses document, ONLY for voting
    // so make sure all the other fields are unchanged
    if(newDoc.author !== username){
        if(newDoc.type === 'item') {
            // make sure only the voted property has changed
            unchanged("created_at");
            unchanged("author");
            unchanged("title");
            unchanged("url");
        } 
    }

    // make sure url is formatted correctly
    if(!isUrl(newDoc.url)) {
        forbidden("URL is formatted incorrectly");
    }

    // TODO make sure other properties are of correct format as well.
    // for now we're checking voted which is the most important one
    // since it dictates the ranking algorithm
    if(!isArray(newDoc.voted)) {
        unauthorized("The voted property must be a JSON array!!");
    }

    // when creating a new doc, the voted property must have 1 item in it, with this username
    if(!oldDoc) {
        if(!newDoc.voted.length) {
            unauthorized("The voted array is empty!")
        }
        if(newDoc.voted[0] !== username) {
            unauthorized("The voted array must have your user in it")
        }
    }

    // check we've voted an item and that the votes are valid
    if(oldDoc) {
        validateVotes(newDoc.voted, oldDoc.voted);
    }
    
    // check the comments
    if(newDoc.comments) {
        // must be array
        if(!isArray(newDoc.comments)) {
            unauthorized("The comment property must be a JSON array!!");
        }

        // make sure all the properties are there
        var newComments = [];
        for(var i in newDoc.comments) {
            var newComment = newDoc.comments[i];
            if(!newComment.comment_id) forbidden("Comment id required");
            if(!newComment.parent_id) forbidden("parent_id for comment is required");
            if(!newComment.author) forbidden("Author for comment is required");
            if(!newComment.voted) forbidden("Voted for comment is required");
            if(!newComment.text) forbidden("Text for comment is required");

            // compare the two to see if they are different
            if(oldDoc) {
                var found = false;
                for(var x in oldDoc.comments) {
                    var oldComment = oldDoc.comments[x];
                    if(oldComment.comment_id === newComment.comment_id) {
                        found = true;
                        validateVotes(newComment.voted, oldComment.voted);
                        break;
                    }
                }
                if(!found) { // hrm maybe it's a new comment?
                    newComments.push(i);
                }
            }
        }
        return; // XXX
        if(newComments.length > 1) forbidden("You're adding too many comments!");

        if(oldDoc && oldDoc.comments.length) {
            // check arrays length now (not before) because we know that we only have 1 new comment
            // therefore the rest must be the same - wow weird logic i know but should work
            if(newComments.length && (newDoc.comments.length === oldDoc.comments.length)) {
                forbidden("You're doing something weird with documents. Like changing its id");
            }
            if(newDoc.comments.length < oldDoc.comments.length) {
                forbidden("You can't delete comments for now");
            }
        }

    }


}

ddoc.views.lib = couchapp.loadFiles('./common');
ddoc.templates = couchapp.loadFiles('./templates');
couchapp.loadAttachments(ddoc, path.join(__dirname, 'attachments'));

module.exports = ddoc;
