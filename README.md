# healthapp
Progressive Web app based on Polymer and Firabase that will fetch your data from withings and draw pretty charts for you.

## Usage :
* Clone the repository
* Create your firebase project : at https://console.firebase.google.com/
* Configure the frontend:
  * Copy .firebaserc.sample and name it .firebaserc
  * Change your project name in this .firebaserc file
  * in frontend/public directory:
  * run bower install
  * copy index.sample.html to index.html
  * edit index.html
  * in frontend folder :
    * run firebase login
    * run firebase use --add
      * select your firebase project and give it an alias
    * run firebase deploy
    * go to firebase console and enable authentication for your project. instructions can be found here: https://codelabs.developers.google.com/codelabs/polymer-firebase-pwa/index.html?index=..%2F..%2Findex#18
      * click authentication on the left menu
      * go to the tab "Sign-In Method"
      * click the pen icon right to the Google provider
      * Toggle to "Enabled" and save
* configure the backend
  * get a withing api code from withings.com
  * load the file database-init.json into your firebase database using the import from json functionality
  * create a service account. Instructions can be found here : https://firebase.google.com/docs/server/setup
    * in firebase console, on the top left of the screen, click the gear-icon on the right of your project and click permissions
    * Select Service accounts from the menu on the left.
    * Click Create service account
    * Enter a name for your service account. You can optionally customize the ID from the one automatically generated from the name.
    * Choose Project > Editor from the Role dropdown.
    * Select Furnish a new private key and leave the Key type as JSON.
    * Leave Enable G Suite Domain-wide Delegation unselected.
    * Click Create. It will download a json file. (keep it safe ! )
  * in the backend directory
  * copy config.sample.json and name it config.json
  * edit config.json and fill the values.
  * run npm install
  * run npm start
* finally, browse to your project's url !
